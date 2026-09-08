// POS (point of sale) — counter sales, V1 staged flow.
// Creates Orders with source="pos". Paths:
//   sell            : immediate cash/utang sale → status COMPLETED (cash: Payment row + change; utang: CreditEntry)
//   hold / complete : staged flow — hold decrements stock (ON_HOLD), complete transitions to COMPLETED
//                     with optional line replacement (resume-edit), void restores stock.
// Totals are always server-computed; stock mutations are atomic.

import { prisma } from "../persistence/prisma-repositories.js";
import { cacheBust, cacheKey } from "../persistence/ttl-cache.js";
import { PrismaOrderSequenceRepository } from "../persistence/prisma-repositories.js";
import { computeOrderTotals } from "../domain/pricing.js";
import { formatOrderNumber } from "../domain/order-number.js";
import { randomId } from "../persistence/repositories.js";
import { CreditService } from "../credit/credit.service.js";
import { LoyaltyService } from "../loyalty/loyalty.service.js";
import type { ApiError, PosSellRequest, PosSellResponse, PosHoldRequest, PosHoldItemsRequest, PosHoldCompleteRequest, PosSellItem, PreOrderCreateRequest, PreOrderFinalizeRequest, PreOrderFinalizeResponse } from "@sam-store/contracts";

export type PosResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const POS_SERVICE = Symbol("POS_SERVICE");

export interface LoadedLine { productId: string; quantity: number; unitPriceMinor: number; name: string; sku: string }

export class PosService {
  private readonly sequences = new PrismaOrderSequenceRepository();
  private readonly credit = new CreditService();

  constructor(private readonly loyalty: LoyaltyService) {}

  // ─── shared helpers ───────────────────────────────────────────────────────────────

  private validateItems(items: unknown): items is PosSellItem[] {
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.every((it) => Number.isInteger((it as PosSellItem).quantity) && (it as PosSellItem).quantity > 0 && (it as PosSellItem).quantity <= 99 && typeof (it as PosSellItem).productId === "string");
  }

  /** v4: signature validation for utang sales (data-URL PNG, ≤ 2M chars). */
  private static readonly SIGNATURE_MAX_LENGTH = 2_000_000;
  private isValidSignature(sig: unknown): boolean {
    return typeof sig === "string" && sig.trim().length > 0 && sig.startsWith("data:image/") && sig.trim().length <= PosService.SIGNATURE_MAX_LENGTH;
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
    cacheBust(cacheKey("customers", storeId));
    return sc.id;
  }

  private async makeOrder(tx: any, storeId: string, actorId: string, data: {
    id: string; orderNumber: string; status: string; paymentMethod: string; paymentStatus: string;
    currencyCode: string; totals: any; storeCustomerId: string | null; customerName: string; lines: LoadedLine[];
    source?: string; discountMinor?: number; totalMinor?: number;
    signatureData?: string | null; signatureAt?: Date | null;
    preorder?: { startAt: string; dueAt: string | null } | null;
  }) {
    const discountMinor = data.discountMinor ?? 0;
    const finalTotal = data.totalMinor ?? Math.max(0, data.totals.totalMinor - discountMinor);
    const signatureAt = data.signatureData ? (data.signatureAt ?? new Date()) : null;
    const source = data.source ?? "pos";
    const items = data.lines.map((l) => ({
      productId: l.productId, productName: l.name, sku: l.sku, unitPriceMinor: l.unitPriceMinor,
      quantity: l.quantity, lineTotalMinor: l.unitPriceMinor * l.quantity,
    }));
    await tx.order.create({
      data: {
        id: data.id, orderNumber: data.orderNumber, storeId, status: data.status, source,
        currencyCode: data.currencyCode, subtotalMinor: data.totals.subtotalMinor, deliveryFeeMinor: 0,
        discountMinor, totalMinor: finalTotal,
        snapshot: {
          lines: items, source: source.toLowerCase(), paymentMethod: data.paymentMethod,
          ...(discountMinor > 0 ? { discountMinor } : {}),
          ...(data.preorder ? { preorder: { startAt: data.preorder.startAt, dueAt: data.preorder.dueAt } } : {}),
          ...(data.signatureData ? { signature: { capturedAt: signatureAt!.toISOString() } } : {}),
        },
        paymentMethod: data.paymentMethod, paymentStatus: data.paymentStatus,
        idempotencyKey: `pos_${data.id}`, cartToken: "", customerName: data.customerName, customerPhone: "",
        deliveryAddressLine1: "", storeCustomerId: data.storeCustomerId,
        signatureData: data.signatureData ?? null, signatureAt,
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
    const { products, lines, totals } = loaded.value;

    const { storeCustomerId: custId, displayName } = await this.resolveCustomer(storeId, input);
    if (input.paymentMethod === "credit" && !custId) {
      return { ok: false, error: { type: "validation", errors: ["Credit sales require a linked customer"] } };
    }

    // v4: utang sales require a captured signature (data-URL PNG).
    if (input.paymentMethod === "credit" && !this.isValidSignature(input.signatureData)) {
      return { ok: false, error: { type: "validation", errors: ["Signature is required for credit sales"] } };
    }

    // v4: loyalty redemption — credit sales with a linked customer only (checkout pattern).
    let discountMinor = 0;
    let loyaltyRedeemed = 0;
    let loyaltyCustomerId: string | null = null;
    if (input.loyaltyPoints) {
      if (input.paymentMethod !== "credit" || !custId) {
        return { ok: false, error: { type: "validation", errors: ["Loyalty redemption requires a credit sale with a linked customer"] } };
      }
      const sc = await prisma.storeCustomer.findUnique({ where: { id: custId } });
      if (!sc) return { ok: false, error: { type: "conflict", message: "Customer not found in this store" } };
      loyaltyCustomerId = sc.customerId;
      const redeemResult = await this.loyalty.redeem(storeId, sc.customerId, input.loyaltyPoints, totals.totalMinor);
      if (!redeemResult.ok) {
        return { ok: false, error: { type: "conflict", message: redeemResult.message } };
      }
      loyaltyRedeemed = input.loyaltyPoints;
      discountMinor += redeemResult.discountMinor;
    }
    const finalTotal = Math.max(0, totals.totalMinor - discountMinor);

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return { ok: false, error: { type: "not_found", message: "Store not found" } };
    const seq = await this.sequences.nextOrderSequence(storeId);
    const orderNumber = formatOrderNumber(store.slug, seq);
    const id = randomId();

    let changeMinor = 0;
    await prisma.$transaction(async (tx) => {
      await this.makeOrder(tx, storeId, actorId, {
        id, orderNumber, status: "COMPLETED", paymentMethod: input.paymentMethod,
        paymentStatus: input.paymentMethod === "cash" ? "COLLECTED" : "PENDING",
        currencyCode: store.currencyCode, totals, storeCustomerId: custId, customerName: displayName, lines,
        discountMinor, totalMinor: finalTotal,
        signatureData: input.paymentMethod === "credit" ? input.signatureData : null,
      });
      if (input.paymentMethod === "cash") {
        const tendered = input.tenderedMinor ?? finalTotal;
        if (tendered < finalTotal) throw new Error("Tendered amount is less than the total");
        changeMinor = tendered - finalTotal;
        await tx.payment.create({
          data: { orderId: id, storeId, method: "cash", amountMinor: finalTotal, changeMinor, type: "payment", createdBy: actorId, note: "POS cash sale" },
        });
      } else {
        const cr = await this.credit.sellOnCredit(tx as never, storeId, custId!, id, finalTotal, actorId, { startAt: input.startAt, dueAt: input.dueAt });
        if (!cr.ok) throw new Error("message" in cr.error ? cr.error.message : "Credit declined");
      }
      await this.decrementStock(tx, storeId, lines);
    }, { timeout: 30_000 });

    // v4: record the redemption only after the order exists (checkout pattern).
    if (loyaltyRedeemed > 0 && loyaltyCustomerId && custId) {
      await this.loyalty.recordRedemption(id, storeId, loyaltyCustomerId, custId, loyaltyRedeemed);
    }
    cacheBust(cacheKey("products", storeId));
    cacheBust(cacheKey("orders", storeId));

    return {
      ok: true,
      value: {
        orderId: id, orderNumber, status: "COMPLETED", totalMinor: finalTotal,
        currencyCode: store.currencyCode, paymentMethod: input.paymentMethod, changeMinor,
        ...(loyaltyRedeemed > 0 ? { loyaltyPointsRedeemed: loyaltyRedeemed } : {}),
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
    }, { timeout: 30_000 });
    return { ok: true, value: { orderId: id, orderNumber, totalMinor: totals.totalMinor } };
  }

  async listHolds(storeId: string) {
    return prisma.order.findMany({
      where: { storeId, status: "ON_HOLD", source: "pos" },
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

  // ─── pre-orders (v4) ──────────────────────────────────────────────────────────────

  /** v4: create a pre-order draft — customer REQUIRED, stock reserved (ON_HOLD + source=PRE_ORDER). */
  async createPreOrder(storeId: string, actorId: string, input: PreOrderCreateRequest): Promise<PosResult<{ orderId: string; orderNumber: string; status: string; totalMinor: number; currencyCode: string }>> {
    if (!this.validateItems(input.items)) {
      return { ok: false, error: { type: "validation", errors: ["At least one item with positive quantity is required"] } };
    }
    const loaded = await this.loadProducts(storeId, input.items);
    if (!loaded.ok) return loaded;
    const { storeCustomerId: custId, displayName } = await this.resolveCustomer(storeId, input);
    if (!custId) {
      return { ok: false, error: { type: "validation", errors: ["Pre-orders require a linked customer"] } };
    }
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return { ok: false, error: { type: "not_found", message: "Store not found" } };
    const seq = await this.sequences.nextOrderSequence(storeId);
    const orderNumber = formatOrderNumber(store.slug, seq);
    const id = randomId();
    const { lines, totals } = loaded.value;

    await prisma.$transaction(async (tx) => {
      await this.makeOrder(tx, storeId, actorId, {
        id, orderNumber, status: "ON_HOLD", source: "PRE_ORDER", paymentMethod: "credit", paymentStatus: "PENDING",
        currencyCode: store.currencyCode, totals, storeCustomerId: custId, customerName: displayName, lines,
        preorder: { startAt: input.startAt ?? new Date().toISOString(), dueAt: input.dueAt ?? null },
      });
      await this.decrementStock(tx, storeId, lines);
    }, { timeout: 30_000 });
    cacheBust(cacheKey("products", storeId));
    cacheBust(cacheKey("orders", storeId));
    return { ok: true, value: { orderId: id, orderNumber, status: "ON_HOLD", totalMinor: totals.totalMinor, currencyCode: store.currencyCode } };
  }

  /** v4: list pre-order drafts (optional createdAt from/to ISO filters). */
  async listPreorders(storeId: string, from?: string, to?: string) {
    return prisma.order.findMany({
      where: {
        storeId, source: "PRE_ORDER",
        ...(from || to ? { createdAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        items: { select: { productId: true, productName: true, sku: true, unitPriceMinor: true, quantity: true, lineTotalMinor: true } },
        storeCustomer: { include: { customer: { select: { name: true } } } },
      },
    }).then((rows) => rows.map((o) => ({
      id: o.id, orderNumber: o.orderNumber, customerName: o.customerName, storeCustomerId: o.storeCustomerId,
      status: o.status, totalMinor: o.totalMinor, createdAt: o.createdAt,
      dueAt: (o.snapshot as any)?.preorder?.dueAt ?? null,
      items: o.items,
    })));
  }

  /** v4: finalize a pre-order — utang only, signature REQUIRED → COMPLETED + CreditEntry. */
  async finalizePreorder(storeId: string, actorId: string, id: string, input: PreOrderFinalizeRequest): Promise<PosResult<PreOrderFinalizeResponse>> {
    const order = await prisma.order.findFirst({ where: { storeId, id, source: "PRE_ORDER", status: "ON_HOLD" } });
    if (!order) return { ok: false, error: { type: "not_found", message: "Pre-order not found" } };
    if (typeof input.signatureData !== "string" || input.signatureData.trim().length === 0) {
      return { ok: false, error: { type: "validation", errors: ["Signature is required"] } };
    }
    const signatureData = input.signatureData.trim();
    if (!signatureData.startsWith("data:image/") || signatureData.length > PosService.SIGNATURE_MAX_LENGTH) {
      return { ok: false, error: { type: "validation", errors: ["Invalid signature"] } };
    }
    if (!order.storeCustomerId) {
      return { ok: false, error: { type: "validation", errors: ["Pre-orders require a linked customer"] } };
    }
    const finalTotal = order.totalMinor;
    const signatureAt = new Date();
    // Fall back to the pre-order's agreed dates when the finalize request omits them.
    const pre = (order.snapshot as any)?.preorder ?? null;
    const startAt = input.startAt ?? pre?.startAt;
    const dueAt = input.dueAt ?? pre?.dueAt;
    let creditEntryId = "";
    await prisma.$transaction(async (tx) => {
      const cr = await this.credit.sellOnCredit(tx as never, storeId, order.storeCustomerId!, id, finalTotal, actorId, { startAt, dueAt });
      if (!cr.ok) throw new Error("message" in cr.error ? cr.error.message : "Credit declined");
      await tx.order.update({
        where: { id },
        data: { status: "COMPLETED", paymentStatus: "PENDING", signatureData, signatureAt },
      });
      const entry = await tx.creditEntry.findFirst({ where: { orderId: id }, orderBy: { createdAt: "desc" } });
      creditEntryId = entry?.id ?? "";
      await tx.orderStatusHistory.create({
        data: { orderId: id, storeId, fromStatus: "ON_HOLD", toStatus: "COMPLETED", actorType: "pos_finalize", actorId },
      });
    }, { timeout: 30_000 });
    cacheBust(cacheKey("orders", storeId));
    return {
      ok: true,
      value: {
        orderId: id, orderNumber: order.orderNumber, status: "COMPLETED", totalMinor: finalTotal,
        currencyCode: order.currencyCode, creditEntryId, signatureAt: signatureAt.toISOString(),
      },
    };
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
    }, { timeout: 30_000 });
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

    // v4: utang sales require a captured signature (data-URL PNG).
    if (input.paymentMethod === "credit" && !this.isValidSignature(input.signatureData)) {
      return { ok: false, error: { type: "validation", errors: ["Signature is required for credit sales"] } };
    }

    // v4: loyalty redemption — credit sales with a linked customer only (checkout pattern).
    let discountMinor = 0;
    let loyaltyRedeemed = 0;
    let loyaltyCustomerId: string | null = null;
    if (input.loyaltyPoints) {
      if (input.paymentMethod !== "credit" || !custId) {
        return { ok: false, error: { type: "validation", errors: ["Loyalty redemption requires a credit sale with a linked customer"] } };
      }
      const sc = await prisma.storeCustomer.findUnique({ where: { id: custId } });
      if (!sc) return { ok: false, error: { type: "conflict", message: "Customer not found in this store" } };
      loyaltyCustomerId = sc.customerId;
      const redeemResult = await this.loyalty.redeem(storeId, sc.customerId, input.loyaltyPoints, totalMinor);
      if (!redeemResult.ok) {
        return { ok: false, error: { type: "conflict", message: redeemResult.message } };
      }
      loyaltyRedeemed = input.loyaltyPoints;
      discountMinor += redeemResult.discountMinor;
    }
    const finalTotal = Math.max(0, totalMinor - discountMinor);
    const signatureAt = new Date();

    let changeMinor = 0;
    await prisma.$transaction(async (tx) => {
      if (input.paymentMethod === "cash") {
        const tendered = input.tenderedMinor ?? finalTotal;
        if (tendered < finalTotal) throw new Error("Tendered amount is less than the total");
        changeMinor = tendered - finalTotal;
        await tx.payment.create({
          data: { orderId: holdId, storeId, method: "cash", amountMinor: finalTotal, changeMinor, type: "payment", createdBy: actorId, note: "POS cash sale (held)" },
        });
      } else {
        const cr = await this.credit.sellOnCredit(tx as never, storeId, custId!, holdId, finalTotal, actorId, { startAt: input.startAt, dueAt: input.dueAt });
        if (!cr.ok) throw new Error("message" in cr.error ? cr.error.message : "Credit declined");
      }
      const cur = await tx.order.findUnique({ where: { id: holdId }, select: { snapshot: true } });
      await tx.order.update({
        where: { id: holdId },
        data: {
          status: "COMPLETED",
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentMethod === "cash" ? "COLLECTED" : "PENDING",
          customerName: displayName,
          storeCustomerId: custId,
          discountMinor,
          totalMinor: finalTotal,
          ...(input.paymentMethod === "credit"
            ? { signatureData: input.signatureData, signatureAt }
            : {}),
          snapshot: {
            ...(cur?.snapshot && typeof cur.snapshot === "object" ? cur.snapshot as Record<string, unknown> : {}),
            ...(input.paymentMethod === "credit" && input.signatureData ? { signature: { capturedAt: signatureAt.toISOString() } } : {}),
          },
        },
      });
      await tx.orderStatusHistory.create({ data: { orderId: holdId, storeId, fromStatus: "ON_HOLD", toStatus: "COMPLETED", actorType: "pos", actorId: actorId } });
    }, { timeout: 30_000 });

    // v4: record loyalty redemption after the order exists (checkout pattern).
        if (loyaltyRedeemed > 0 && loyaltyCustomerId && custId) {
          await this.loyalty.recordRedemption(holdId, storeId, loyaltyCustomerId, custId, loyaltyRedeemed);
        }
        cacheBust(cacheKey("products", storeId));
    cacheBust(cacheKey("orders", storeId));

        return {
          ok: true,
          value: {
            orderId: holdId, orderNumber: hold.orderNumber, status: "COMPLETED", totalMinor: finalTotal,
            currencyCode: hold.currencyCode, paymentMethod: input.paymentMethod, changeMinor,
            ...(loyaltyRedeemed > 0 ? { loyaltyPointsRedeemed: loyaltyRedeemed } : {}),
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
    }, { timeout: 30_000 });
    cacheBust(cacheKey("products", storeId));
    cacheBust(cacheKey("orders", storeId));
    return { ok: true, value: { id: holdId, status: "CANCELLED" } };
  }
}