// Order admin service — status transitions with the state machine + audit history.

import { prisma } from "../persistence/prisma-repositories.js";
import { assertTransition, paymentEffectFor, type OrderState } from "../domain/order-state.js";
import { LoyaltyService } from "../loyalty/loyalty.service.js";
import type { ApiError } from "@sam-store/contracts";

export type AdminResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export class OrderAdminService {
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
}