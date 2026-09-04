// Loyalty service — earn points on delivered orders, redeem at checkout, ledger.
// Encapsulates the StoreCustomer balance updates + LoyaltyEntry audit trail.

import { prisma } from "../persistence/prisma-repositories.js";
import { pointsEarned, redeemDiscountMinor } from "../domain/loyalty.js";
import type { ApiError } from "@sam-store/contracts";
import type { LoyaltyGateway } from "../checkout/checkout.service.js";

export type LoyaltyResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** DI token. */
export const LOYALTY_SERVICE = Symbol("LOYALTY_SERVICE");

export class LoyaltyService implements LoyaltyGateway {
  /** Ensure a per-store customer profile exists (created lazily at checkout). */
  async ensureProfile(storeId: string, customerId: string): Promise<{ storeCustomerId: string }> {
    const sc = await prisma.storeCustomer.upsert({
      where: { storeId_customerId: { storeId, customerId } },
      update: {},
      create: { storeId, customerId },
    });
    return { storeCustomerId: sc.id };
  }

  /** Earn points for a delivered order (idempotent: only when order.storeCustomerId set). */
  async earnForDeliveredOrder(orderId: string): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { storeCustomer: true },
    });
    if (!order?.storeCustomerId || !order.storeCustomer) return;
    // Already earned? (Earn entries for this order exist → skip)
    const existing = await prisma.loyaltyEntry.findFirst({ where: { orderId, type: "EARN" } });
    if (existing) return;

    const points = pointsEarned(order.totalMinor);
    if (points <= 0) return;

    await prisma.$transaction(async (tx) => {
      const sc = await tx.storeCustomer.update({
        where: { id: order.storeCustomerId! },
        data: { loyaltyBalancePoints: { increment: points } },
      });
      await tx.loyaltyEntry.create({
        data: {
          storeId: order.storeId,
          customerId: sc.customerId,
          storeCustomerId: sc.id,
          type: "EARN",
          points,
          balanceAfter: sc.loyaltyBalancePoints,
          orderId,
          description: `Earned ${points} pts for order ${order.orderNumber}`,
        },
      });
    });
  }

  /** Redeem points at checkout — validates balance, returns discount + debits. */
  async redeem(
    storeId: string,
    customerId: string,
    points: number,
    orderTotalMinor: number,
  ): Promise<{ ok: true; discountMinor: number; storeCustomerId: string } | { ok: false; message: string }> {
    if (!Number.isInteger(points) || points <= 0) return { ok: false, message: "Invalid points" };
    const discountMinor = redeemDiscountMinor(points);
    if (discountMinor <= 0) return { ok: false, message: "Minimum 100 points to redeem" };
    if (discountMinor > orderTotalMinor) return { ok: false, message: "Redemption exceeds order total" };

    const sc = await prisma.storeCustomer.findUnique({
      where: { storeId_customerId: { storeId, customerId } },
    });
    if (!sc) return { ok: false, message: "No customer profile for this store" };
    if (sc.loyaltyBalancePoints < points) {
      return { ok: false, message: `Insufficient points (balance ${sc.loyaltyBalancePoints})` };
    }

    return { ok: true, discountMinor, storeCustomerId: sc.id };
  }

  /** Record the actual redemption (called after order creation). */
  async recordRedemption(orderId: string, storeId: string, customerId: string, storeCustomerId: string, points: number): Promise<void> {
    const discountMinor = redeemDiscountMinor(points);
    await prisma.$transaction(async (tx) => {
      const sc = await tx.storeCustomer.update({
        where: { id: storeCustomerId },
        data: { loyaltyBalancePoints: { decrement: points } },
      });
      await tx.loyaltyEntry.create({
        data: {
          storeId,
          customerId,
          storeCustomerId,
          type: "REDEEM",
          points: -points,
          balanceAfter: sc.loyaltyBalancePoints,
          orderId,
          description: `Redeemed ${points} pts for ₱${discountMinor / 100} off`,
        },
      });
    });
  }

  /** Customer ledger + balance (public, customer-authed). */
  async customerLedger(storeId: string, customerId: string) {
    const sc = await prisma.storeCustomer.findUnique({
      where: { storeId_customerId: { storeId, customerId } },
    });
    if (!sc) return { balance: 0, entries: [] };
    const entries = await prisma.loyaltyEntry.findMany({
      where: { storeCustomerId: sc.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { balance: sc.loyaltyBalancePoints, entries: entries.map((e) => ({ type: e.type, points: e.points, balanceAfter: e.balanceAfter, description: e.description, createdAt: e.createdAt })) };
  }

  /** Admin: store customers with balances. Filters: search (name/email/phone), approvalStatus, onlyUtang. */
  async adminCustomers(storeId: string, f: { search?: string; approvalStatus?: string; onlyUtang?: boolean } = {}) {
    const where: Record<string, unknown> = { storeId };
    if (f.approvalStatus) where.approvalStatus = f.approvalStatus;
    if (f.onlyUtang) where.creditBalanceMinor = { gt: 0 };
    if (f.search) {
      where.customer = {
        OR: [
          { name: { contains: f.search, mode: "insensitive" } },
          { email: { contains: f.search, mode: "insensitive" } },
          { phone: { contains: f.search, mode: "insensitive" } },
        ],
      };
    }
    return prisma.storeCustomer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { id: true, email: true, name: true, phone: true } } },
    });
  }

  /** Admin: single customer profile with recent orders + credit entries + loyalty. */
  async adminCustomerProfile(storeId: string, storeCustomerId: string) {
    const sc = await prisma.storeCustomer.findFirst({
      where: { storeId, id: storeCustomerId },
      include: {
        customer: { select: { id: true, email: true, name: true, phone: true } },
        credit: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!sc) return null;
    const orders = await prisma.order.findMany({
      where: { storeId, storeCustomerId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, orderNumber: true, status: true, totalMinor: true, source: true, createdAt: true, paymentStatus: true },
    });
    return {
      id: sc.id,
      customer: sc.customer,
      approvalStatus: sc.approvalStatus,
      loyaltyBalancePoints: sc.loyaltyBalancePoints,
      creditApproved: sc.creditApproved,
      creditLimitMinor: sc.creditLimitMinor,
      creditBalanceMinor: sc.creditBalanceMinor,
      createdAt: sc.createdAt,
      orders,
      creditEntries: sc.credit.map((e) => ({ id: e.id, type: e.type, amountMinor: e.amountMinor, note: e.note, orderId: e.orderId, createdAt: e.createdAt })),
    };
  }
}