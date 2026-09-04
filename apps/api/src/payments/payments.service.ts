// Payments, receipts, voids & refunds.
// - Payments attach to orders (cash / credit / cod_collected), with change for cash.
// - Receipt view: deterministic printable layout (browser print) — store, order, line items,
//   totals, VAT display-only label (decision #2), payment info.
// - Void (same-day, unfulfilled POS sale): reverses the sale, restores stock, order → CANCELLED.
// - Refund: negative Payment + order → CANCELLED with reason (audited).

import { prisma } from "../persistence/prisma-repositories.js";
import type { ApiError } from "@sam-store/contracts";

export type PaymentResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const PAYMENTS_SERVICE = Symbol("PAYMENTS_SERVICE");

export class PaymentsService {
  /** Record a payment against an order. */
  async recordPayment(input: {
    orderId: string;
    storeId: string;
    method: "cash" | "credit" | "cod_collected";
    amountMinor: number;
    changeMinor?: number;
    note?: string;
    createdBy?: string;
  }): Promise<PaymentResult<{ id: string }>> {
    const order = await prisma.order.findFirst({ where: { id: input.orderId, storeId: input.storeId } });
    if (!order) return { ok: false, error: { type: "not_found", message: "Order not found" } };
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return { ok: false, error: { type: "validation", errors: ["amountMinor must be a positive integer"] } };
    }
    const payment = await prisma.payment.create({
      data: {
        orderId: input.orderId,
        storeId: input.storeId,
        method: input.method,
        amountMinor: input.amountMinor,
        changeMinor: input.changeMinor ?? 0,
        note: input.note?.trim() ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    return { ok: true, value: { id: payment.id } };
  }

  /** Receipt view for an order (deterministic). */
  async receipt(orderId: string, storeId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: {
        items: true,
        payments: { orderBy: { receivedAt: "asc" } },
        store: { select: { name: true, slug: true, currencyCode: true } },
        storeCustomer: { include: { customer: { select: { name: true, phone: true } } } },
      },
    });
    if (!order) return null;
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      source: order.source,
      storeName: order.store.name,
      currencyCode: order.currencyCode,
      subtotalMinor: order.subtotalMinor,
      deliveryFeeMinor: order.deliveryFeeMinor,
      discountMinor: order.discountMinor,
      totalMinor: order.totalMinor,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({ productName: i.productName, sku: i.sku, unitPriceMinor: i.unitPriceMinor, quantity: i.quantity, lineTotalMinor: i.lineTotalMinor })),
      payments: order.payments.map((p) => ({ id: p.id, method: p.method, amountMinor: p.amountMinor, changeMinor: p.changeMinor, type: p.type, note: p.note, receivedAt: p.receivedAt })),
    };
  }

  /** Void an unfulfilled POS sale (same-day): restores stock, order → CANCELLED. */
  async voidOrder(orderId: string, storeId: string, actorId: string, reason?: string): Promise<PaymentResult<{ id: string; status: string }>> {
    const order = await prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: { items: { select: { productId: true, quantity: true } } },
    });
    if (!order) return { ok: false, error: { type: "not_found", message: "Order not found" } };
    if (order.source !== "pos") return { ok: false, error: { type: "conflict", message: "Only POS orders can be voided" } };
    if (order.paymentStatus === "COLLECTED") return { ok: false, error: { type: "conflict", message: "Collected sales must be refunded, not voided" } };

    await prisma.$transaction(async (tx) => {
      // Restore stock (per line)
      for (const item of order.items) {
        if (!item.productId) continue;
        const level = await tx.stockLevel.findFirst({ where: { storeId, productId: item.productId } });
        if (level) await tx.stockLevel.update({ where: { id: level.id }, data: { quantityOnHand: { increment: item.quantity } } });
      }
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", paymentStatus: "CANCELLED_REFUND" } });
      await tx.payment.create({
        data: { orderId, storeId, method: "cash", amountMinor: 0, note: `VOID: ${reason?.trim() ?? "same-day void"}`.slice(0, 200), type: "void", createdBy: actorId },
      });
      await tx.orderStatusHistory.create({
        data: { orderId, storeId, fromStatus: order.status, toStatus: "CANCELLED", reason: reason?.trim() ?? null, actorType: "pos_void", actorId },
      });
    });
    return { ok: true, value: { id: orderId, status: "CANCELLED" } };
  }

  /** Refund a collected sale: negative Payment + order → CANCELLED (audited). */
  async refundOrder(orderId: string, storeId: string, actorId: string, amountMinor?: number, reason?: string): Promise<PaymentResult<{ id: string; status: string }>> {
    const order = await prisma.order.findFirst({ where: { id: orderId, storeId } });
    if (!order) return { ok: false, error: { type: "not_found", message: "Order not found" } };
    if (order.paymentStatus !== "COLLECTED") return { ok: false, error: { type: "conflict", message: "Only collected orders can be refunded" } };
    const refundAmount = amountMinor ?? order.totalMinor;
    if (!Number.isInteger(refundAmount) || refundAmount <= 0) {
      return { ok: false, error: { type: "validation", errors: ["refund amount must be a positive integer"] } };
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: { orderId, storeId, method: "cash", amountMinor: -refundAmount, note: `REFUND: ${reason?.trim() ?? "customer refund"}`.slice(0, 200), type: "refund", createdBy: actorId },
      });
      await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", paymentStatus: "CANCELLED_REFUND" } });
      await tx.orderStatusHistory.create({
        data: { orderId, storeId, fromStatus: order.status, toStatus: "CANCELLED", reason: reason?.trim() ?? null, actorType: "pos_refund", actorId },
      });
    });
    return { ok: true, value: { id: orderId, status: "CANCELLED" } };
  }

  /** Payment history for an order. */
  async paymentsFor(orderId: string, storeId: string) {
    const order = await prisma.order.findFirst({ where: { id: orderId, storeId }, select: { id: true } });
    if (!order) return null;
    return prisma.payment.findMany({ where: { orderId }, orderBy: { receivedAt: "asc" } });
  }
}