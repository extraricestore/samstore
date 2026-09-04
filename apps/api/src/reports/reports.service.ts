// Reports — profit summary, sales splits, utang aging, top customers.
// Decision #9: profit/expense/COGS visible ONLY to OWNER + MANAGER (enforced in controller).
// COGS uses latest purchase cost (Product.costMinor) — labeled as an estimate.

import { prisma } from "../persistence/prisma-repositories.js";

export const REPORTS_SERVICE = Symbol("REPORTS_SERVICE");

export class ReportsService {
  /** Fulfilled orders in period (DELIVERED or COMPLETED — excludes CANCELLED/voided). */
  private async fulfilledOrders(storeId: string, from: Date, to: Date) {
    return prisma.order.findMany({
      where: { storeId, status: { in: ["DELIVERED", "COMPLETED"] }, createdAt: { gte: from, lte: to } },
      include: {
        items: { include: { product: { select: { costMinor: true } } } },
        payments: { where: { type: "refund" }, select: { amountMinor: true } },
      },
    });
  }

  /** Profit summary: revenue − refunds − COGS − expenses. COGS is an estimate. */
  async profitSummary(storeId: string, from: Date, to: Date) {
    const orders = await this.fulfilledOrders(storeId, from, to);
    const revenue = orders.reduce((s, o) => s + o.totalMinor, 0);
    const refunds = orders.reduce((s, o) => s + o.payments.reduce((r, p) => r + Math.abs(p.amountMinor), 0), 0);
    let cogs = 0;
    let cogsEstimatedUnits = 0;
    for (const o of orders) {
      for (const it of o.items) {
        const cost = it.product?.costMinor ?? 0;
        cogs += it.quantity * cost;
        if (cost <= 0) cogsEstimatedUnits += it.quantity;
      }
    }
    const expensesRows = await prisma.expense.findMany({ where: { storeId, spentAt: { gte: from, lte: to } } });
    const expenses = expensesRows.reduce((s, e) => s + e.amountMinor, 0);
    const netRevenue = revenue - refunds;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      revenueMinor: revenue,
      refundsMinor: refunds,
      netRevenueMinor: netRevenue,
      cogsMinor: cogs,
      cogsEstimatedUnits,
      expensesMinor: expenses,
      profitMinor: netRevenue - cogs - expenses,
      ordersCount: orders.length,
      cogsNote: cogsEstimatedUnits > 0
        ? `COGS is an estimate: ${cogsEstimatedUnits} unit(s) sold had no purchase cost on record (counted at ₱0).`
        : "COGS uses the latest purchase cost per product.",
    };
  }

  /** Sales split by payment method + top customers + utang aging. */
  async salesReport(storeId: string, from: Date, to: Date) {
    const orders = await this.fulfilledOrders(storeId, from, to);
    const byMethod: Record<string, number> = {};
    for (const o of orders) byMethod[o.paymentMethod] = (byMethod[o.paymentMethod] ?? 0) + o.totalMinor;

    const byCustomer = new Map<string, { name: string; totalMinor: number; orders: number }>();
    for (const o of orders) {
      const key = o.customerName || "Walk-in";
      const cur = byCustomer.get(key) ?? { name: key, totalMinor: 0, orders: 0 };
      cur.totalMinor += o.totalMinor;
      cur.orders += 1;
      byCustomer.set(key, cur);
    }
    const topCustomers = [...byCustomer.values()].sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 10);

    // Utang aging: per customer with balance, age from their oldest purchase entry.
    const debtors = await prisma.storeCustomer.findMany({
      where: { storeId, creditBalanceMinor: { gt: 0 } },
      include: {
        customer: { select: { name: true } },
        credit: { where: { type: "purchase" }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
      },
    });
    const now = Date.now();
    const rows = debtors.map((d) => {
      const oldest = d.credit[0]?.createdAt.getTime() ?? now;
      const days = Math.floor((now - oldest) / 86_400_000);
      return { name: d.customer.name ?? "Customer", balanceMinor: d.creditBalanceMinor, daysOld: days, bucket: days > 30 ? "over30" : "current" } as { name: string; balanceMinor: number; daysOld: number; bucket: string };
    });
    const aging = {
      currentMinor: rows.filter((r) => r.bucket === "current").reduce((s, r) => s + r.balanceMinor, 0),
      over30Minor: rows.filter((r) => r.bucket === "over30").reduce((s, r) => s + r.balanceMinor, 0),
      rows,
    };

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      paymentSplit: Object.entries(byMethod).map(([method, totalMinor]) => ({ method, totalMinor })),
      topCustomers,
      utangAging: aging,
    };
  }
}