// Credit (utang) ledger — per-store customer open balances.
// - approveCredit: owner/manager approves a customer for utang with a limit.
// - sellOnCredit: POS/online credit sale → CreditEntry(purchase, +amount), balance up.
// - recordPayment: cash settlement → CreditEntry(payment, -amount) + Payment row.
// - utangList: customers with outstanding balances.
// Limits: per-customer creditLimitMinor, else store settings creditLimitMinor; 0 = disabled.

import { prisma } from "../persistence/prisma-repositories.js";
import type { ApiError } from "@sam-store/contracts";

export type CreditResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const CREDIT_SERVICE = Symbol("CREDIT_SERVICE");

export class CreditService {
  /** Approve a store customer for utang with a limit (minor units). */
  async approveCredit(storeId: string, storeCustomerId: string, limitMinor: number, actorId: string): Promise<CreditResult<{ id: string; creditApproved: boolean; creditLimitMinor: number }>> {
    if (!Number.isInteger(limitMinor) || limitMinor < 0) {
      return { ok: false, error: { type: "validation", errors: ["limitMinor must be a non-negative integer"] } };
    }
    const sc = await prisma.storeCustomer.findFirst({ where: { storeId, id: storeCustomerId } });
    if (!sc) return { ok: false, error: { type: "not_found", message: "Customer not found in this store" } };
    const updated = await prisma.storeCustomer.update({
      where: { id: sc.id },
      data: { creditApproved: true, creditLimitMinor: limitMinor },
    });
    return { ok: true, value: { id: updated.id, creditApproved: updated.creditApproved, creditLimitMinor: updated.creditLimitMinor } };
  }

  /** Effective limit for a customer (per-customer override, else store default). */
  private async effectiveLimit(storeId: string, sc: { creditLimitMinor: number }): Promise<number> {
    if (sc.creditLimitMinor > 0) return sc.creditLimitMinor;
    const settings = await prisma.storeSettings.findUnique({ where: { storeId } });
    return settings?.creditLimitMinor ?? 0;
  }

  /** V1: store credit term (days) for default due dates. */
  async effectiveTermDays(storeId: string): Promise<number> {
    const settings = await prisma.storeSettings.findUnique({ where: { storeId } });
    return settings?.creditTermDays ?? 30;
  }

  /** V1: default dueAt from term (or an explicit dueAt). */
  private async defaultDueAt(storeId: string, startAt: Date | undefined, dueAt: string | undefined): Promise<{ start: Date; due: Date | null }> {
    const start = startAt ?? new Date();
    if (dueAt) return { start, due: new Date(dueAt) };
    const term = await this.effectiveTermDays(storeId);
    return { start, due: new Date(start.getTime() + term * 86_400_000) };
  }

  /** Record a credit purchase (debt) against a customer. Call inside the order transaction. */
  async sellOnCredit(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], storeId: string, storeCustomerId: string, orderId: string, amountMinor: number, actorId: string, opts: { startAt?: string; dueAt?: string } = {}): Promise<CreditResult<{ balanceMinor: number }>> {
    const sc = await tx.storeCustomer.findFirst({ where: { storeId, id: storeCustomerId } });
    if (!sc) return { ok: false, error: { type: "not_found", message: "Customer not found in this store" } };
    if (!sc.creditApproved) return { ok: false, error: { type: "conflict", message: "Customer is not approved for credit" } };
    const limit = await this.effectiveLimit(storeId, sc);
    if (limit <= 0) return { ok: false, error: { type: "conflict", message: "Credit is disabled for this store" } };
    if (sc.creditBalanceMinor + amountMinor > limit) {
      return { ok: false, error: { type: "conflict", message: `Credit limit exceeded (limit ₱${(limit / 100).toFixed(2)})` } };
    }
    const { start, due } = await this.defaultDueAt(storeId, opts.startAt ? new Date(opts.startAt) : undefined, opts.dueAt);
    await tx.creditEntry.create({
      data: { storeId, storeCustomerId, orderId, type: "purchase", amountMinor, startAt: start, dueAt: due, note: "POS credit sale", createdBy: actorId },
    });
    const updated = await tx.storeCustomer.update({
      where: { id: sc.id },
      data: { creditBalanceMinor: { increment: amountMinor } },
    });
    return { ok: true, value: { balanceMinor: updated.creditBalanceMinor } };
  }

  /** Read-only eligibility check for online credit checkout. */
  async checkCredit(storeId: string, storeCustomerId: string, amountMinor: number): Promise<{ ok: true } | { ok: false; message: string }> {
    const sc = await prisma.storeCustomer.findFirst({ where: { storeId, id: storeCustomerId } });
    if (!sc) return { ok: false, message: "Customer not found in this store" };
    if (!sc.creditApproved) return { ok: false, message: "Customer is not approved for credit" };
    const limit = await this.effectiveLimit(storeId, sc);
    if (limit <= 0) return { ok: false, message: "Credit is disabled for this store" };
    if (sc.creditBalanceMinor + amountMinor > limit) {
      return { ok: false, message: `Credit limit exceeded (limit ₱${(limit / 100).toFixed(2)})` };
    }
    return { ok: true };
  }

  /** Record an online credit purchase (after order creation). */
  async recordPurchase(orderId: string, storeId: string, storeCustomerId: string, amountMinor: number, startAt?: string, dueAt?: string): Promise<void> {
    const { start, due } = await this.defaultDueAt(storeId, startAt ? new Date(startAt) : undefined, dueAt);
    await prisma.$transaction(async (tx) => {
      await tx.creditEntry.create({
        data: { storeId, storeCustomerId, orderId, type: "purchase", amountMinor, startAt: start, dueAt: due, note: "Online credit checkout", createdBy: null },
      });
      await tx.storeCustomer.update({
        where: { id: storeCustomerId },
        data: { creditBalanceMinor: { increment: amountMinor } },
      });
    });
  }

  /** Record a cash payment against utang. */
  async recordPayment(storeId: string, storeCustomerId: string, amountMinor: number, note: string | undefined, actorId: string): Promise<CreditResult<{ balanceMinor: number; paymentId: string }>> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return { ok: false, error: { type: "validation", errors: ["amountMinor must be a positive integer"] } };
    }
    const sc = await prisma.storeCustomer.findFirst({ where: { storeId, id: storeCustomerId } });
    if (!sc) return { ok: false, error: { type: "not_found", message: "Customer not found in this store" } };
    if (sc.creditBalanceMinor <= 0) return { ok: false, error: { type: "conflict", message: "Customer has no outstanding balance" } };
    const pay = Math.min(amountMinor, sc.creditBalanceMinor);

    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: { storeId, method: "credit", amountMinor: pay, note: note?.trim() ?? "Utang payment", type: "payment", createdBy: actorId },
      });
      await tx.creditEntry.create({
        data: { storeId, storeCustomerId, type: "payment", amountMinor: -pay, note: note?.trim() ?? "Utang payment", createdBy: actorId },
      });
      const updated = await tx.storeCustomer.update({
        where: { id: sc.id },
        data: { creditBalanceMinor: { decrement: pay } },
      });
      return { paymentId: p.id, balanceMinor: updated.creditBalanceMinor };
    });
    return { ok: true, value: payment };
  }

  /** Customers with outstanding balances (Utang list). V1: status = unpaid | paid. */
  async utangList(storeId: string, status: "unpaid" | "paid" = "unpaid") {
    const where: Record<string, unknown> = { storeId, credit: { some: {} } };
    if (status === "unpaid") where.creditBalanceMinor = { gt: 0 };
    else where.creditBalanceMinor = { equals: 0 };
    const rows = await prisma.storeCustomer.findMany({
      where,
      orderBy: status === "unpaid" ? { creditBalanceMinor: "desc" } : { updatedAt: "desc" },
      include: {
        customer: { select: { name: true, phone: true } },
        credit: { orderBy: { createdAt: "asc" }, select: { type: true, createdAt: true, startAt: true, dueAt: true } },
      },
    });
    return rows.map((r) => {
      const purchases = r.credit.filter((e) => e.type === "purchase");
      const payments = r.credit.filter((e) => e.type === "payment");
      const oldestDue = purchases.reduce<Date | null>((m, e) => (e.dueAt && (!m || e.dueAt < m) ? e.dueAt : m), null);
      const firstPurchaseAt = purchases[0]?.startAt ?? null;
      const paidAt = payments.length > 0 ? payments[payments.length - 1]!.createdAt : null;
      const daysOverdue = oldestDue && oldestDue.getTime() < Date.now() ? Math.floor((Date.now() - oldestDue.getTime()) / 86_400_000) : 0;
      return {
        id: r.id,
        customerName: r.customer.name,
        phone: r.customer.phone,
        balanceMinor: r.creditBalanceMinor,
        creditLimitMinor: r.creditLimitMinor,
        creditApproved: r.creditApproved,
        firstPurchaseAt,
        oldestDueAt: oldestDue,
        daysOverdue,
        paidAt,
      };
    });
  }

  /** Full ledger for one customer. */
  async customerCredit(storeId: string, storeCustomerId: string) {
    const sc = await prisma.storeCustomer.findFirst({
      where: { storeId, id: storeCustomerId },
      include: {
        customer: { select: { name: true, phone: true } },
        credit: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!sc) return null;
    return {
      id: sc.id,
      customerName: sc.customer.name,
      phone: sc.customer.phone,
      creditApproved: sc.creditApproved,
      creditLimitMinor: sc.creditLimitMinor,
      balanceMinor: sc.creditBalanceMinor,
      entries: sc.credit.map((e) => ({ id: e.id, type: e.type, amountMinor: e.amountMinor, startAt: e.startAt, dueAt: e.dueAt, note: e.note, orderId: e.orderId, createdAt: e.createdAt })),
    };
  }
}