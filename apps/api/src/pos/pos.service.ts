// POS (point of sale) — counter sales, V1 staged flow.
// Creates Orders with source="pos". Paths:
//   sell            : immediate cash/utang sale → status COMPLETED (cash: Payment row + change; utang: CreditEntry)
//   hold / complete : staged flow — hold decrements stock (ON_HOLD), complete transitions to COMPLETED
//                     with optional line replacement (resume-edit), void restores stock.
// Totals are always server-computed; stock mutations are atomic.

import { prisma } from "../persistence/prisma-repositories.js";
import { PrismaOrderSequenceRepository } from "../persistence/prisma-repositories.js";
import { computeOrderTotals } from "../domain/pricing.js";
import { formatOrderNumber } from "../domain/order-number.js";
import { randomId } from "../persistence/repositories.js";
import { CreditService } from "../credit/credit.service.js";
import type { ApiError, PosSellRequest, PosSellResponse, PosHoldRequest, PosHoldItemsRequest, PosHoldCompleteRequest, PosSellItem } from "@sam-store/contracts";

export type PosResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const POS_SERVICE = Symbol("POS_SERVICE");

export interface LoadedLine { productId: string; quantity: number; unitPriceMinor: number; name: string; sku: string }

export class PosService {
  private readonly sequences = new PrismaOrderSequenceRepository();
  private readonly credit = new CreditService();

  // ─── shared helpers ───────────────────────────────────────────────────────────────

  private validateItems(items: unknown): items is PosSellItem[] {
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.every((it) => Number.isInteger((it as PosSellItem).quantity) && (it as PosSellItem).quantity > 0 && (it as PosSellItem).quantity <= 99 && typeof (it as PosSellItem).productId === "string");
  }

  /** Load fresh products for a store (active) + validate availability. */
  private async loadProducts(storeId: string, items: PosSellItem[]): Promise<PosResult<{ products: any[]; lines: LoadedLine[]; totals: any }>> {
    const ids = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { storeId, id: { in: ids }, isActive: true },
      include: { stockLevels: true },
    });
    if (products.length !== new Set(ids).size) {
      return { ok: false, error: { type: "not_found", message: "One or more products not found or inactive" } };
    }
    for (const it of items) {
      const p = products.find((x) => x.id === it.productId)!;
      const available = p.stockLevels.reduce((s, l) => s + (l.quantityOnHand - l.quantityReserved), 0);
      if (available < it.quantity) {
        return { ok: false, error: { type: "conflict", message: `Only ${available} in stock for ${p.name}` } };
      }
    }
    let totals;
    try {
      totals = computeOrderTotals({
        lines: items.map((it) => {
          const p = products.find((x) => x.id === it.productId)!;
          return { unitPriceMinor: p.priceMinor, quantity: it.quantity };
        }),
      });
    } catch (e) {
      return { ok: false, error: { type: "conflict", message: e instanceof Error ? e.message : "Invalid pricing" } };
    }
    const lines: LoadedLine[] = items.map((it) => {
      const p = products.find((x) => x.id === it.productId)!;
      return { productId: p.id, quantity: it.quantity, unitPriceMinor: p.priceMinor, name: p.name, sku: p.sku };
    });
    return { ok: true, value: { products, lines, totals } };
  }

  /** Decrement stock for a set of lines (prefer default warehouse, then any level). */
  private async decrementStock(tx: any, storeId: string, lines: LoadedLine[]) {
    for (const l of lines) {
      const levels = await tx.stockLevel.findMany({ where: { storeId, productId: l.productId, quantityOnHand: { gt: 0 } } });
      levels.sort((a: any, b: any) => (a.warehouseId ? 0 : 1) - (b.warehouseId ? 0 : 1));
      let remaining = l.quantity;
      for (const lvl of levels) {
        if (remaining <= 0) break;
        const take = Math.min(lvl.quantityOnHand, remaining);
        if (take > 0) {
          await tx.stockLevel.update({ where: { id: lvl.id }, data: { quantityOnHand: { decrement: take } } });
          remaining -= take;
        }
      }
    }
  }

  /** Increment stock back for a set of lines (void / cancel). */
  private async restoreStock(tx: any, storeId: string, lines: LoadedLine[]) {
    for (const l of lines) {
      const level = await tx.stockLevel.findFirst({ where: { storeId, productId: l.productId } });
      if (level) {
        await tx.stockLevel.update({ where: { id: level.id }, data: { quantityOnHand: { increment: l.quantity } } });
      }
    }
  }

  private async resolveCustomer(storeId: string, input: { customerId?: string; customerName?: string; customerPhone?: string }): Promise<{ storeCustomerId: string | null; displayName: string }> {
    if (input.customerId) {
      const sc = await prisma.storeCustomer.findFirst({ where: { storeId, id: input.customerId } });
      if (!sc) return { storeCustomerId: null, displayName: "Walk-in" };
      const cust = await prisma.customer.findUnique({ where: { id: sc.customerId } });
      return { storeCustomerId: sc.id, displayName: cust?.name ?? input.customerName ?? "Customer" };
    }
    if (input.customerName) {
      const sc = await this.quickCustomer(storeId, input.customerName, input.customerPhone);
      return { storeCustomerId: sc, displayName: input.customerName };
    }
    return { storeCustomerId: null, displayName: "Walk-in" };
  }

  /** V1: create (or reuse by phone) a store customer without a login account. */
  async quickCustomer(storeId: string, name: string, phone?: string): Promise<string | null> {
    const cleanName = name?.trim();
    if (!cleanName) return null;
    let customer: any = null;
    if (phone?.trim()) {
      customer = await prisma.customer.findFirst({ where: { phone: phone.trim() } });
    }
    if (!customer) {
      customer = await prisma.customer.create({ data: { name: cleanName, phone: phone?.trim() ?? null, email: null, passwordHash: null } });
    }
    const sc = await prisma.storeCustomer.upsert({
      where: { storeId_customerId: { storeId, customerId: customer.id } },
      update: {},
      create: { storeId, customerId: customer.id },
    });
    return sc.id;
  }

  private async makeOrder(tx: any, storeId: string, actorId: string, data: {
    id: string; orderNumber: string; status: string; paymentMethod: string; paymentStatus: string;
    currencyCode: string; totals: any; storeCustomerId: string | null; customerName: string; lines: LoadedLine[];
  }) {
    const items = data.lines.map((l) => ({
      productId: l.productId, productName: l.name, sku: l.sku, unitPriceMinor: l.unitPriceMinor,
      quantity: l.quantity, lineTotalMinor: l.unitPriceMinor * l.quantity,
    }));
    await tx.order.create({
      data: {
        id: data.id, orderNumber: data.orderNumber, storeId, status: data.status, source: "pos",
        currencyCode: data.currencyCode, subtotalMinor: data.totals.subtotalMinor, deliveryFeeMinor: 0,
        discountMinor: 0, totalMinor: data.totals.totalMinor,
        snapshot: { lines: items, source: "pos", paymentMethod: data.paymentMethod },
        paymentMethod: data.paymentMethod, paymentStatus: data.paymentStatus,
        idempotencyKey: `pos_${data.id}`, cartToken: "", customerName: data.customerName, customerPhone: "",
        deliveryAddressLine1: "", storeCustomerId: data.storeCustomerId,
      },
    });
    await tx.orderItem.createMany({
      data: items.map((i) => ({ orderId: data.id, storeId, productId: i.productId, productName: i.productName, sku: i.sku, unitPriceMinor: i.unitPriceMinor, quantity: i.quantity, lineTotalMinor: i.lineTotalMinor })),
    });
    await tx.orderStatusHistory.create({ data: { orderId: data.id, storeId, toStatus: data.status, actorType: "pos", actorId: actorId } });
  }

  // ─── immediate sale ───────────────────────────────────────────────────────────────

  async sell(storeId: string, actorId: string, input: PosSellRequest): Promise<PosResult<PosSellResponse>> {
    if (!this.validateItems(input.items)) {
      return { ok: false, error: { type: "validation", errors: ["At least one item with positive quantity is required"] } };
    }
    if (!["cash", "credit"].includes(input.paymentMethod)) {
      return { ok: false, error: { type: "validation", errors: ["paymentMethod must be cash or credit"] } };
    }
    if (input.paymentMethod === "cash" && input.tenderedMinor !== undefined && !Number.isInteger(input.tenderedMinor)) {
      return { ok: false, error: { type: "validation", errors: ["tenderedMinor must be an integer"] } };
    }

    const loaded = await this.loadProducts(storeId, input.items);
    if (!loaded.ok) return loaded;

    const { storeCustomerId: custId, displayName } = await this.resolveCustomer(storeId, input);
    if (input.paymentMethod === "credit" && !custId) {
      return { ok: false, error: { type: "validation", errors: ["Credit sales require a linked customer"] } };
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return { ok: false, error: { type: "not_found", message: "Store not found" } };
    const seq = await this.sequences.nextOrderSequence(storeId);
    const orderNumber = formatOrderNumber(store.slug, seq);
    const id = randomId();
    const { products, lines, totals } = loaded.value;

    let changeMinor = 0;
    await prisma.$transaction(async (tx) => {
      await this.makeOrder(tx, storeId, actorId, {
        id, orderNumber, status: "COMPLETED", paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentMethod === "cash" ? "COLLECTED" : "PENDING",
        currencyCode: store.currencyCode, totals, storeCustomerId: custId, customerName: displayName, lines,
      });
      if (input.paymentMethod === "cash") {
        const tendered = input.tenderedMinor ?? totals.totalMinor;
        if (tendered < totals.totalMinor) throw new Error("Tendered amount is less than the total");
        changeMinor = tendered - totals.totalMinor;
        await tx.payment.create({
          data: { orderId: id, storeId, method: "cash", amountMinor: totals.totalMinor, changeMinor, type: "payment", createdBy: actorId, note: "POS cash sale" },
        });
      } else {
        const cr = await this.credit.sellOnCredit(tx as never, storeId, custId!, id, totals.totalMinor, actorId, { startAt: input.startAt, dueAt: input.dueAt });
        if (!cr.ok) throw new Error("message" in cr.error ? cr.error.message : "Credit declined");
      }
      await this.decrementStock(tx, storeId, lines);
    });

    return {
      ok: true,
      value: {
        orderId: id, orderNumber, status: "COMPLETED", totalMinor: totals.totalMinor,
        currencyCode: store.currencyCode, paymentMethod: input.paymentMethod, changeMinor,
      },
    };
  }

  // ─── hold / staged flow ───────────────────────────────────────────────────────────

  async hold(storeId: string, actorId: string, input: PosHoldRequest): Promise<PosResult<{ orderId: string; orderNumber: string; totalMinor: number }>> {
    if (!this.validateItems(input.items)) {
      return { ok: false, error: { type: "validation", errors: ["At least one item with positive quantity is required"] } };
    }
    const loaded = await this.loadProducts(storeId, input.items);
    if (!loaded.ok) return loaded;
    const { storeCustomerId: custId, displayName } = await this.resolveCustomer(storeId, input);
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return { ok: false, error: { type: "not_found", message: "Store not found" } };
    const seq = await this.sequences.nextOrderSequence(storeId);
    const orderNumber = formatOrderNumber(store.slug, seq);
    const id = randomId();
    const { lines, totals } = loaded.value;

    await prisma.$transaction(async (tx) => {
      await this.makeOrder(tx, storeId, actorId, {
        id, orderNumber, status: "ON_HOLD", paymentMethod: "cash", paymentStatus: "PENDING",
        currencyCode: store.currencyCode, totals, storeCustomerId: custId, customerName: displayName, lines,
      });
      await this.decrementStock(tx, storeId, lines);
    });
    return { ok: true, value: { orderId: id, orderNumber, totalMinor: totals.totalMinor } };
  }

  async listHolds(storeId: string) {
    return prisma.order.findMany({
      where: { storeId, status: "ON_HOLD" },
      orderBy: { createdAt: "desc" },
      include: {
        items: { select: { productId: true, productName: true, sku: true, unitPriceMinor: true, quantity: true, lineTotalMinor: true } },
        storeCustomer: { include: { customer: { select: { name: true } } } },
      },
    }).then((rows) => rows.map((o) => ({
      id: o.id, orderNumber: o.orderNumber, totalMinor: o.totalMinor, customerName: o.customerName,
      storeCustomerId: o.storeCustomerId, createdAt: o.createdAt, items: o.items,
    })));
  }

  async replaceItems(storeId: string, actorId: string, holdId: string, input: PosHoldItemsRequest): Promise<PosResult<{ id: string; totalMinor: number; lines: LoadedLine[] }>> {
    if (!this.validateItems(input.items)) {
      return { ok: false, error: { type: "validation", errors: ["At least one item with positive quantity is required"] } };
    }
    const hold = await prisma.order.findFirst({ where: { storeId, id: holdId, status: "ON_HOLD" } });
    if (!hold) return { ok: false, error: { type: "not_found", message: "Held order not found" } };

    const loaded = await this.loadProducts(storeId, input.items);
    if (!loaded.ok) return loaded;
    const oldItems = await prisma.orderItem.findMany({ where: { orderId: holdId } });
    const oldLines: LoadedLine[] = oldItems.map((i) => ({ productId: i.productId ?? "", quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, name: i.productName, sku: i.sku }));
    const { lines, totals } = loaded.value;

    await prisma.$transaction(async (tx) => {
      // Restore stock for removed lines, decrement for added (delta approach).
      await this.restoreStock(tx, storeId, oldLines);
      await this.decrementStock(tx, storeId, lines);
      await tx.orderItem.deleteMany({ where: { orderId: holdId } });
      await tx.orderItem.createMany({
        data: lines.map((l) => ({
          orderId: holdId, storeId, productId: l.productId, productName: l.name, sku: l.sku,
          unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, lineTotalMinor: l.unitPriceMinor * l.quantity,
        })),
      });
      await tx.order.update({ where: { id: holdId }, data: { subtotalMinor: totals.subtotalMinor, totalMinor: totals.totalMinor, snapshot: { lines, source: "pos", paymentMethod: "cash" } as object } });
      await tx.orderStatusHistory.create({ data: { orderId: holdId, storeId, fromStatus: "ON_HOLD", toStatus: "ON_HOLD", reason: "items edited", actorType: "pos", actorId: actorId } });
    });
    return { ok: true, value: { id: holdId, totalMinor: totals.totalMinor, lines } };
  }

  async completeHold(storeId: string, actorId: string, holdId: string, input: PosHoldCompleteRequest): Promise<PosResult<PosSellResponse>> {
    const hold = await prisma.order.findFirst({ where: { storeId, id: holdId, status: "ON_HOLD" } });
    if (!hold) return { ok: false, error: { type: "not_found", message: "Held order not found" } };
    if (!["cash", "credit"].includes(input.paymentMethod)) {
      return { ok: false, error: { type: "validation", errors: ["paymentMethod must be cash or credit"] } };
    }

    // Optional resume-edit: replace lines first.
    let totalMinor = hold.totalMinor;
    let lines: LoadedLine[] = [];
    if (input.items) {
      const replaced = await this.replaceItems(storeId, actorId, holdId, { items: input.items });
      if (!replaced.ok) return replaced;
      totalMinor = replaced.value.totalMinor;
      lines = replaced.value.lines;
    } else {
      const items = await prisma.orderItem.findMany({ where: { orderId: holdId } });
      lines = items.map((i) => ({ productId: i.productId ?? "", quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, name: i.productName, sku: i.sku }));
    }

    const { storeCustomerId: custId, displayName } = input.paymentMethod === "credit"
      ? await this.resolveCustomer(storeId, input)
      : await this.resolveCustomer(storeId, { customerId: input.customerId, customerName: hold.customerName });
    if (input.paymentMethod === "credit" && !custId) {
      return { ok: false, error: { type: "validation", errors: ["Credit sales require a linked customer"] } };
    }

    let changeMinor = 0;
    await prisma.$transaction(async (tx) => {
      if (input.paymentMethod === "cash") {
        const tendered = input.tenderedMinor ?? totalMinor;
        if (tendered < totalMinor) throw new Error("Tendered amount is less than the total");
        changeMinor = tendered - totalMinor;
        await tx.payment.create({
          data: { orderId: holdId, storeId, method: "cash", amountMinor: totalMinor, changeMinor, type: "payment", createdBy: actorId, note: "POS cash sale (held)" },
        });
      } else {
        const cr = await this.credit.sellOnCredit(tx as never, storeId, custId!, holdId, totalMinor, actorId, { startAt: input.startAt, dueAt: input.dueAt });
        if (!cr.ok) throw new Error("message" in cr.error ? cr.error.message : "Credit declined");
      }
      await tx.order.update({
        where: { id: holdId },
        data: {
          status: "COMPLETED",
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentMethod === "cash" ? "COLLECTED" : "PENDING",
          customerName: displayName,
          storeCustomerId: custId,
        },
      });
      await tx.orderStatusHistory.create({ data: { orderId: holdId, storeId, fromStatus: "ON_HOLD", toStatus: "COMPLETED", actorType: "pos", actorId: actorId } });
    });

    return {
      ok: true,
      value: {
        orderId: holdId, orderNumber: hold.orderNumber, status: "COMPLETED", totalMinor,
        currencyCode: hold.currencyCode, paymentMethod: input.paymentMethod, changeMinor,
      },
    };
  }

  async voidHold(storeId: string, actorId: string, holdId: string, reason?: string): Promise<PosResult<{ id: string; status: string }>> {
    const hold = await prisma.order.findFirst({ where: { storeId, id: holdId, status: "ON_HOLD" } });
    if (!hold) return { ok: false, error: { type: "not_found", message: "Held order not found" } };
    const items = await prisma.orderItem.findMany({ where: { orderId: holdId } });
    const lines: LoadedLine[] = items.map((i) => ({ productId: i.productId ?? "", quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, name: i.productName, sku: i.sku }));

    await prisma.$transaction(async (tx) => {
      await this.restoreStock(tx, storeId, lines);
      await tx.order.update({ where: { id: holdId }, data: { status: "CANCELLED", paymentStatus: "CANCELLED_REFUND" } });
      await tx.orderStatusHistory.create({
        data: { orderId: holdId, storeId, fromStatus: "ON_HOLD", toStatus: "CANCELLED", reason: reason?.trim() ?? null, actorType: "pos_void", actorId: actorId },
      });
    });
    return { ok: true, value: { id: holdId, status: "CANCELLED" } };
  }
}