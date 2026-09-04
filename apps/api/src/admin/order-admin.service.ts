// Order admin service — status transitions with the state machine + audit history.

import { prisma } from "../persistence/prisma-repositories.js";
import { assertTransition, paymentEffectFor, type OrderState } from "../domain/order-state.js";
import { computeOrderTotals } from "../domain/pricing.js";
import { LoyaltyService } from "../loyalty/loyalty.service.js";
import type { NotificationsService } from "../notifications/notifications.service.js";
import type { ApiError } from "@sam-store/contracts";

export type AdminResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export class OrderAdminService {
  constructor(private readonly notify?: NotificationsService) {}
  /** Transition an order's status (forward state machine; reason for manual overrides). */
  async transition(
    storeId: string,
    orderId: string,
    toStatus: OrderState,
    reason?: string,
    actor?: { type: string; id: string | null },
  ): Promise<AdminResult<{ id: string; status: OrderState }>> {
    const order = await prisma.order.findFirst({ where: { id: orderId, storeId } });
    if (!order) return { ok: false, error: { type: "not_found", message: "Order not found" } };

    const from = order.status as OrderState;
    try {
      assertTransition(from, toStatus, reason);
    } catch (e) {
      return {
        ok: false,
        error: { type: "conflict", message: e instanceof Error ? e.message : "Invalid transition" },
      };
    }

    const paymentStatus = paymentEffectFor(toStatus, order.paymentStatus);

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: toStatus, paymentStatus: paymentStatus as never },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          storeId,
          fromStatus: from,
          toStatus,
          reason: reason?.trim() ?? null,
          actorType: actor?.type ?? "system",
          actorId: actor?.id ?? null,
        },
      });
    });

    // Loyalty: award points when the order is delivered (and linked to a customer).
    if (toStatus === "DELIVERED") {
      await this.awardLoyalty(orderId);
    }

    // Notifications: status change → customer (Messenger suppressed until connected; SMS/email recorded).
    if (this.notify) {
      await this.notify.notify({
        storeId,
        customerPhone: order.customerPhone,
        psid: null, // no verified PSID yet — suppressed path
        template: toStatus === "OUT_FOR_DELIVERY" ? "order_out_for_delivery" : "order_status",
        data: { orderNumber: order.orderNumber, status: toStatus },
      });
    }

    return { ok: true, value: { id: orderId, status: toStatus } };
  }

  /** Award loyalty points for a delivered order (idempotent via LoyaltyEntry). */
  private async awardLoyalty(orderId: string): Promise<void> {
    const loyalty = new LoyaltyService();
    await loyalty.earnForDeliveredOrder(orderId);
  }

  /** Order detail with items + history (for the admin). */
  async detail(storeId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: {
        items: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
        claimTokens: { select: { token: true, usedAt: true, expiresAt: true } },
      },
    });
    if (!order) return null;
    return order;
  }

  // ─────────────────────────────── W1: edit + routing ───────────────────────────────

  /** Editable statuses: RECEIVED | CONFIRMED | ON_HOLD (POS held). */
  private static EDITABLE = ["RECEIVED", "CONFIRMED", "ON_HOLD"];

  /** W1: replace an order's items with stock-delta (restore removed, deduct added). */
  async replaceOrderItems(storeId: string, orderId: string, items: { productId: string; quantity: number }[]): Promise<AdminResult<{ id: string; status: string; totalMinor: number }>> {
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, error: { type: "validation", errors: ["At least one item with positive quantity is required"] } };
    }
    for (const it of items) {
      if (!Number.isInteger(it.quantity) || it.quantity <= 0 || it.quantity > 99) {
        return { ok: false, error: { type: "validation", errors: ["quantity must be a positive integer (max 99)"] } };
      }
    }
    const order = await prisma.order.findFirst({ where: { storeId, id: orderId } });
    if (!order) return { ok: false, error: { type: "not_found", message: "Order not found" } };
    if (!OrderAdminService.EDITABLE.includes(order.status)) {
      return { ok: false, error: { type: "conflict", message: `Cannot edit an order in ${order.status}` } };
    }

    // Fresh products + availability
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

    // Totals (no delivery fee change: keep the order's original decision; recompute lines only)
    const totals = computeOrderTotals({
      lines: items.map((it) => {
        const p = products.find((x) => x.id === it.productId)!;
        return { unitPriceMinor: p.priceMinor, quantity: it.quantity };
      }),
    });

    const oldItems = await prisma.orderItem.findMany({ where: { orderId } });
    const newLines = items.map((it) => {
      const p = products.find((x) => x.id === it.productId)!;
      return { productId: p.id, productName: p.name, sku: p.sku, unitPriceMinor: p.priceMinor, quantity: it.quantity, lineTotalMinor: p.priceMinor * it.quantity };
    });

    await prisma.$transaction(async (tx) => {
      // Stock-delta: restore old, deduct new (net effect = difference)
      for (const oi of oldItems) {
        const level = await tx.stockLevel.findFirst({ where: { storeId, productId: oi.productId ?? "" } });
        if (level) await tx.stockLevel.update({ where: { id: level.id }, data: { quantityOnHand: { increment: oi.quantity } } });
      }
      for (const nl of newLines) {
        const p = products.find((x) => x.id === nl.productId)!;
        const levels = await tx.stockLevel.findMany({ where: { storeId, productId: nl.productId, quantityOnHand: { gt: 0 } } });
        levels.sort((a, b) => (a.warehouseId ? 0 : 1) - (b.warehouseId ? 0 : 1));
        let remaining = nl.quantity;
        for (const lvl of levels) {
          if (remaining <= 0) break;
          const take = Math.min(lvl.quantityOnHand, remaining);
          if (take > 0) { await tx.stockLevel.update({ where: { id: lvl.id }, data: { quantityOnHand: { decrement: take } } }); remaining -= take; }
        }
      }
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.orderItem.createMany({
        data: newLines.map((l) => ({ orderId, storeId, productId: l.productId, productName: l.productName, sku: l.sku, unitPriceMinor: l.unitPriceMinor, quantity: l.quantity, lineTotalMinor: l.lineTotalMinor })),
      });
      await tx.order.update({
        where: { id: orderId },
        data: { subtotalMinor: totals.subtotalMinor, totalMinor: totals.totalMinor + order.deliveryFeeMinor - order.discountMinor, snapshot: { lines: newLines, source: order.source, paymentMethod: order.paymentMethod } as object },
      });
      await tx.orderStatusHistory.create({
        data: { orderId, storeId, fromStatus: order.status, toStatus: order.status, reason: "items edited", actorType: "admin", actorId: null },
      });
    });

    return { ok: true, value: { id: orderId, status: order.status, totalMinor: totals.totalMinor + order.deliveryFeeMinor - order.discountMinor } };
  }

  /** W1: one-tap advance CONFIRMED/PREPARING/READY → OUT_FOR_DELIVERY (delivery-type only). */
  async sendForDelivery(storeId: string, orderId: string): Promise<AdminResult<{ id: string; status: string }>> {
    const order = await prisma.order.findFirst({ where: { storeId, id: orderId } });
    if (!order) return { ok: false, error: { type: "not_found", message: "Order not found" } };
    if (order.deliveryType !== "delivery") {
      return { ok: false, error: { type: "conflict", message: "Only delivery-type orders can be sent for delivery" } };
    }
    if (!["CONFIRMED", "PREPARING", "READY"].includes(order.status)) {
      return { ok: false, error: { type: "conflict", message: `Cannot send an order in ${order.status} for delivery` } };
    }
    const hops: OrderState[] = order.status === "CONFIRMED"
      ? ["PREPARING", "READY", "OUT_FOR_DELIVERY"]
      : order.status === "PREPARING" ? ["READY", "OUT_FOR_DELIVERY"] : ["OUT_FOR_DELIVERY"];

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: "OUT_FOR_DELIVERY", paymentStatus: order.paymentStatus } });
      for (let i = 0; i < hops.length; i++) {
        await tx.orderStatusHistory.create({
          data: { orderId, storeId, fromStatus: i === 0 ? order.status : (hops[i - 1] as OrderState), toStatus: hops[i] as OrderState, reason: "send-for-delivery (one-tap)", actorType: "admin", actorId: null },
        });
      }
    });
    return { ok: true, value: { id: orderId, status: "OUT_FOR_DELIVERY" } };
  }

  /** W1: complete a pickup/POS order directly from RECEIVED/CONFIRMED. */
  async completeNow(storeId: string, orderId: string): Promise<AdminResult<{ id: string; status: string }>> {
    const order = await prisma.order.findFirst({ where: { storeId, id: orderId } });
    if (!order) return { ok: false, error: { type: "not_found", message: "Order not found" } };
    if (order.deliveryType === "delivery" || (order.deliveryAddressLine1 && order.deliveryAddressLine1.trim().length > 0)) {
      return { ok: false, error: { type: "conflict", message: "Delivery orders must go through the delivery pipeline" } };
    }
    if (!["RECEIVED", "CONFIRMED"].includes(order.status)) {
      return { ok: false, error: { type: "conflict", message: `Cannot complete an order in ${order.status}` } };
    }
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: "COMPLETED", paymentStatus: "COLLECTED" } });
      await tx.orderStatusHistory.create({
        data: { orderId, storeId, fromStatus: order.status, toStatus: "COMPLETED", reason: "move-to-completed (pickup)", actorType: "admin", actorId: null },
      });
    });
    return { ok: true, value: { id: orderId, status: "COMPLETED" } };
  }
}