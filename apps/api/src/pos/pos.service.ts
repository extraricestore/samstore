// POS (point of sale) — counter sales.
// Creates a normal Order with source="pos", status COMPLETED, payment captured at
// completion (CASH/CREDIT). Totals are always server-computed; stock is decremented
// atomically at completion. Online flow is untouched.

import { prisma } from "../persistence/prisma-repositories.js";
import { PrismaOrderSequenceRepository } from "../persistence/prisma-repositories.js";
import { computeOrderTotals } from "../domain/pricing.js";
import { formatOrderNumber } from "../domain/order-number.js";
import { randomId } from "../persistence/repositories.js";
import { CreditService } from "../credit/credit.service.js";
import type { ApiError, PosSellRequest, PosSellResponse } from "@sam-store/contracts";

export type PosResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const POS_SERVICE = Symbol("POS_SERVICE");

export class PosService {
  private readonly sequences = new PrismaOrderSequenceRepository();
  private readonly credit = new CreditService();

  async sell(storeId: string, actorId: string, input: PosSellRequest): Promise<PosResult<PosSellResponse>> {
    // 1. Validate items
    if (!Array.isArray(input.items) || input.items.length === 0) {
      return { ok: false, error: { type: "validation", errors: ["At least one item is required"] } };
    }
    for (const it of input.items) {
      if (!Number.isInteger(it.quantity) || it.quantity <= 0 || it.quantity > 99) {
        return { ok: false, error: { type: "validation", errors: ["quantity must be a positive integer (max 99)"] } };
      }
    }
    if (!["cash", "credit"].includes(input.paymentMethod)) {
      return { ok: false, error: { type: "validation", errors: ["paymentMethod must be cash or credit"] } };
    }

    // 2. Load products (store-scoped, active) + availability
    const ids = input.items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { storeId, id: { in: ids }, isActive: true },
      include: { stockLevels: true },
    });
    if (products.length !== new Set(ids).size) {
      return { ok: false, error: { type: "not_found", message: "One or more products not found or inactive" } };
    }
    for (const it of input.items) {
      const p = products.find((x) => x.id === it.productId)!;
      const available = p.stockLevels.reduce((s, l) => s + (l.quantityOnHand - l.quantityReserved), 0);
      if (available < it.quantity) {
        return { ok: false, error: { type: "conflict", message: `Only ${available} in stock for ${p.name}` } };
      }
    }

    // 3. Server-authoritative totals (no delivery fee for counter sales)
    let totals;
    try {
      totals = computeOrderTotals({
        lines: input.items.map((it) => {
          const p = products.find((x) => x.id === it.productId)!;
          return { unitPriceMinor: p.priceMinor, quantity: it.quantity };
        }),
      });
    } catch (e) {
      return { ok: false, error: { type: "conflict", message: e instanceof Error ? e.message : "Invalid pricing" } };
    }

    // 4. Optional customer link (must belong to the store); credit REQUIRES a customer
    let storeCustomerId: string | null = null;
    if (input.customerId) {
      const sc = await prisma.storeCustomer.findFirst({ where: { storeId, id: input.customerId } });
      if (!sc) return { ok: false, error: { type: "not_found", message: "Customer not found in this store" } };
      storeCustomerId = sc.id;
    }
    if (input.paymentMethod === "credit" && !storeCustomerId) {
      return { ok: false, error: { type: "validation", errors: ["Credit sales require a linked customer"] } };
    }

    // 5. Store + sequence → order number
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return { ok: false, error: { type: "not_found", message: "Store not found" } };
    const seq = await this.sequences.nextOrderSequence(storeId);
    const orderNumber = formatOrderNumber(store.slug, seq);
    const id = randomId();

    // 6. Create order + snapshot + history + decrement stock (atomic)
    const items = input.items.map((it) => {
      const p = products.find((x) => x.id === it.productId)!;
      return {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        unitPriceMinor: p.priceMinor,
        quantity: it.quantity,
        lineTotalMinor: p.priceMinor * it.quantity,
      };
    });

    await prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id,
          orderNumber,
          storeId,
          status: "COMPLETED",
          source: "pos",
          currencyCode: store.currencyCode,
          subtotalMinor: totals.subtotalMinor,
          deliveryFeeMinor: 0,
          discountMinor: 0,
          totalMinor: totals.totalMinor,
          snapshot: { lines: items, source: "pos", paymentMethod: input.paymentMethod },
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentMethod === "cash" ? "COLLECTED" : "PENDING",
          idempotencyKey: `pos_${id}`,
          cartToken: "",
          customerName: input.customerName ?? "Walk-in",
          customerPhone: "",
          deliveryAddressLine1: "",
          storeCustomerId,
        },
      });
      await tx.orderItem.createMany({
        data: items.map((i) => ({ orderId: id, storeId, productId: i.productId, productName: i.productName, sku: i.sku, unitPriceMinor: i.unitPriceMinor, quantity: i.quantity, lineTotalMinor: i.lineTotalMinor })),
      });
      await tx.orderStatusHistory.create({
        data: { orderId: id, storeId, toStatus: "COMPLETED", actorType: "pos", actorId: actorId },
      });
      // Credit sale → ledger entry (throws roll back the whole sale)
      if (input.paymentMethod === "credit" && storeCustomerId) {
        const cr = await this.credit.sellOnCredit(tx as never, storeId, storeCustomerId, id, totals.totalMinor, actorId);
        if (!cr.ok) throw new Error("message" in cr.error ? cr.error.message : (cr.error as { errors?: string[] }).errors?.[0] ?? "Credit declined");
      }
      // Decrement stock (prefer default warehouse, then any level)
      for (const it of input.items) {
        const p = products.find((x) => x.id === it.productId)!;
        let remaining = it.quantity;
        const levels = [...p.stockLevels].sort((a, b) => (a.warehouseId ? 0 : 1) - (b.warehouseId ? 0 : 1));
        for (const lvl of levels) {
          if (remaining <= 0) break;
          const take = Math.min(lvl.quantityOnHand, remaining);
          if (take > 0) {
            await tx.stockLevel.update({ where: { id: lvl.id }, data: { quantityOnHand: { decrement: take } } });
            remaining -= take;
          }
        }
      }
    });

    return {
      ok: true,
      value: {
        orderId: id,
        orderNumber,
        status: "COMPLETED",
        totalMinor: totals.totalMinor,
        currencyCode: store.currencyCode,
        paymentMethod: input.paymentMethod,
      },
    };
  }
}