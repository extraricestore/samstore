// N2 — split and partial payments (+ tender/change), and the per-store payment-method
// registry. One command records every tender for an order inside ONE transaction:
//
//   outstanding = order.totalMinor − Σ tenders + Σ refunds   (never negative)
//
// Rules enforced server-side:
//   • Σ(applied amounts) may not exceed the outstanding balance (no overpayment);
//   • a CASH tender may hand over more than it applies — the difference is CHANGE;
//   • non-cash methods that require a reference must carry one;
//   • an utang (CREDIT) tender writes a CreditEntry through the credit service, so the
//     customer's limit guard applies to the credit portion only;
//   • every tender is attributed to the open drawer shift when its method is CASH;
//   • replaying the same idempotencyKey returns the SAME rows (no double charge).
//
// Deliberately NOT stored: a "PARTIAL/PAID" flag. Settlement is DERIVED from the payment
// rows on every read (`settlement` + `outstandingMinor`), so it cannot drift — the enum
// change would also have to touch checkout/delivery/POS semantics for no gain.

import { prisma } from "../persistence/prisma-repositories.js";
import { CreditService } from "../credit/credit.service.js";
import { RegisterService } from "../registers/register.service.js";
import type { ApiError } from "@sam-store/contracts";

export const SPLIT_PAYMENT_SERVICE = "SPLIT_PAYMENT_SERVICE";

export type SplitResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface TenderInput {
  methodCode: string;
  amountMinor: number;
  /** Cash handed over (≥ amountMinor). Change = tendered − applied. */
  tenderedMinor?: number;
  /** e-wallet / bank reference (required by methods flagged requiresReference). */
  reference?: string;
}
export type Settlement = "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";

export interface PaymentSummary {
  orderId: string;
  orderNumber: string;
  totalMinor: number;
  paidMinor: number; // Σ applied tenders
  refundedMinor: number; // Σ refunds (positive)
  outstandingMinor: number;
  changeMinor: number; // Σ change handed back
  settlement: Settlement;
  tenders: {
    id: string;
    method: string;
    amountMinor: number;
    tenderedMinor: number | null;
    changeMinor: number;
    reference: string | null;
    type: string;
    receivedAt: string;
    createdBy: string | null;
  }[];
}

/** Methods a store gets the first time it takes a payment. */
const DEFAULT_METHODS: { code: string; label: string; kind: "CASH" | "CREDIT" | "EWALLET" | "TRANSFER"; requiresReference: boolean; sortOrder: number }[] = [
  { code: "cash", label: "Cash", kind: "CASH", requiresReference: false, sortOrder: 0 },
  { code: "credit", label: "Utang (credit)", kind: "CREDIT", requiresReference: false, sortOrder: 1 },
  { code: "gcash", label: "GCash", kind: "EWALLET", requiresReference: true, sortOrder: 2 },
  { code: "maya", label: "Maya", kind: "EWALLET", requiresReference: true, sortOrder: 3 },
  { code: "bank_transfer", label: "Bank transfer", kind: "TRANSFER", requiresReference: true, sortOrder: 4 },
];

export class SplitPaymentService {
  private readonly credit = new CreditService();
  private readonly registers = new RegisterService();

  /** The store's payment methods, seeded on first use. */
  async ensureMethods(storeId: string) {
    const existing = await prisma.paymentMethod.count({ where: { storeId } });
    if (existing === 0) {
      await prisma.paymentMethod.createMany({ data: DEFAULT_METHODS.map((m) => ({ ...m, storeId })), skipDuplicates: true });
    }
    return prisma.paymentMethod.findMany({ where: { storeId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  }

  async listMethods(storeId: string) {
    const methods = await this.ensureMethods(storeId);
    return methods;
  }

  async upsertMethod(storeId: string, input: { code: string; label: string; kind?: string; requiresReference?: boolean; enabled?: boolean; sortOrder?: number }) {
    const code = input.code?.trim().toLowerCase();
    if (!code || !/^[a-z0-9_]{2,32}$/.test(code)) {
      return { ok: false as const, error: { type: "validation", errors: ["code must be 2-32 chars of a-z 0-9 _"] } as ApiError };
    }
    const label = input.label?.trim();
    if (!label || label.length > 60) {
      return { ok: false as const, error: { type: "validation", errors: ["label is required (max 60 chars)"] } as ApiError };
    }
    const kind = (input.kind ?? "OTHER").toUpperCase();
    if (!["CASH", "CREDIT", "EWALLET", "TRANSFER", "OTHER"].includes(kind)) {
      return { ok: false as const, error: { type: "validation", errors: ["kind must be CASH, CREDIT, EWALLET, TRANSFER or OTHER"] } as ApiError };
    }
    const method = await prisma.paymentMethod.upsert({
      where: { storeId_code: { storeId, code } },
      update: {
        label,
        kind: kind as never,
        requiresReference: input.requiresReference ?? false,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
      create: {
        storeId,
        code,
        label,
        kind: kind as never,
        requiresReference: input.requiresReference ?? false,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return { ok: true as const, value: method };
  }

  /** Derived settlement for an order (single source of truth = the payment rows). */
  async summaryFor(storeId: string, orderId: string): Promise<PaymentSummary | null> {
    const order = await prisma.order.findFirst({ where: { id: orderId, storeId }, select: { id: true, orderNumber: true, totalMinor: true } });
    if (!order) return null;
    const rows = await prisma.payment.findMany({
      where: { storeId, orderId },
      orderBy: { receivedAt: "asc" },
      select: { id: true, method: true, amountMinor: true, tenderedMinor: true, changeMinor: true, reference: true, type: true, receivedAt: true, createdBy: true },
    });
    const paidMinor = rows.filter((r) => r.type !== "void" && r.amountMinor > 0).reduce((s, r) => s + r.amountMinor, 0);
    const refundedMinor = rows.filter((r) => r.type === "refund").reduce((s, r) => s + -r.amountMinor, 0);
    const net = paidMinor - refundedMinor;
    const outstandingMinor = Math.max(0, order.totalMinor - net);
    const settlement: Settlement =
      order.totalMinor === 0 ? "PAID" : net <= 0 ? "UNPAID" : net > order.totalMinor ? "OVERPAID" : outstandingMinor > 0 ? "PARTIAL" : "PAID";
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalMinor: order.totalMinor,
      paidMinor,
      refundedMinor,
      outstandingMinor,
      changeMinor: rows.reduce((s, r) => s + r.changeMinor, 0),
      settlement,
      tenders: rows.map((r) => ({
        id: r.id,
        method: r.method,
        amountMinor: r.amountMinor,
        tenderedMinor: r.tenderedMinor,
        changeMinor: r.changeMinor,
        reference: r.reference,
        type: r.type,
        receivedAt: r.receivedAt.toISOString(),
        createdBy: r.createdBy,
      })),
    };
  }

  /**
   * Record one or more tenders against an order. Idempotent by (orderId, idempotencyKey).
   */
  async recordTenders(
    storeId: string,
    actorId: string,
    orderId: string,
    input: { tenders: TenderInput[]; idempotencyKey: string; note?: string },
  ): Promise<SplitResult<PaymentSummary>> {
    const key = input.idempotencyKey?.trim();
    if (!key || key.length < 8 || key.length > 200) {
      return { ok: false, error: { type: "validation", errors: ["idempotencyKey is required (8-200 chars)"] } };
    }
    if (!Array.isArray(input.tenders) || input.tenders.length === 0) {
      return { ok: false, error: { type: "validation", errors: ["at least one tender is required"] } };
    }
    if (input.tenders.length > 8) {
      return { ok: false, error: { type: "validation", errors: ["at most 8 tenders per payment"] } };
    }

    // Replay: the same key already produced rows for this order → return them unchanged.
    const replayed = await prisma.payment.findFirst({ where: { storeId, orderId, idempotencyKey: key }, select: { id: true } });
    if (replayed) {
      const summary = await this.summaryFor(storeId, orderId);
      return summary ? { ok: true, value: summary } : { ok: false, error: { type: "not_found", message: "Order not found" } };
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, storeId },
      select: { id: true, orderNumber: true, totalMinor: true, status: true, storeCustomerId: true, customerName: true },
    });
    if (!order) return { ok: false, error: { type: "not_found", message: "Order not found" } };
    if (order.status === "CANCELLED") {
      return { ok: false, error: { type: "conflict", message: "A cancelled order cannot take payments" } };
    }

    const methods = await this.ensureMethods(storeId);
    const byCode = new Map(methods.map((m) => [m.code, m]));

    // Validate every tender before touching the database.
    const validated: { method: (typeof methods)[number]; applied: number; tendered: number | null; change: number; reference: string | null }[] = [];
    let appliedTotal = 0;
    for (const t of input.tenders) {
      const method = byCode.get((t.methodCode ?? "").trim().toLowerCase());
      if (!method) return { ok: false, error: { type: "validation", errors: [`unknown payment method: ${t.methodCode}`] } };
      if (!method.enabled) return { ok: false, error: { type: "conflict", message: `${method.label} is disabled for this store` } };
      if (!Number.isInteger(t.amountMinor) || t.amountMinor <= 0) {
        return { ok: false, error: { type: "validation", errors: [`amountMinor must be a positive integer (${method.code})`] } };
      }
      const reference = t.reference?.trim() || null;
      if (method.requiresReference && !reference) {
        return { ok: false, error: { type: "validation", errors: [`${method.label} requires a reference number`] } };
      }
      let tendered: number | null = null;
      let change = 0;
      if (method.kind === "CASH") {
        tendered = t.tenderedMinor === undefined ? t.amountMinor : t.tenderedMinor;
        if (!Number.isInteger(tendered) || tendered < t.amountMinor) {
          return { ok: false, error: { type: "validation", errors: ["cash tendered cannot be less than the amount applied"] } };
        }
        change = tendered - t.amountMinor;
      } else if (t.tenderedMinor !== undefined) {
        return { ok: false, error: { type: "validation", errors: [`only cash tenders can hand over more than they apply (${method.code})`] } };
      }
      if (method.kind === "CREDIT") {
        if (!order.storeCustomerId) {
          return { ok: false, error: { type: "validation", errors: ["Utang requires a customer linked to the order"] } };
        }
        // Fast-fail on the customer's remaining limit BEFORE writing anything.
        const creditOk = await this.credit.checkCredit(storeId, order.storeCustomerId, t.amountMinor);
        if (!creditOk.ok) {
          return { ok: false, error: { type: "conflict", message: creditOk.message } };
        }
      }
      appliedTotal += t.amountMinor;
      validated.push({ method, applied: t.amountMinor, tendered, change, reference });
    }

    const before = await this.summaryFor(storeId, orderId);
    const outstanding = before?.outstandingMinor ?? order.totalMinor;
    if (appliedTotal > outstanding) {
      return {
        ok: false,
        error: { type: "conflict", message: `Tenders exceed the outstanding balance of ₱${(outstanding / 100).toFixed(2)}` },
      };
    }

    // Every tender taken during an open shift belongs to that shift's report (cash
    // counts toward the drawer, the rest is listed as non-cash takings).
    const registerSessionId = await this.registers.attachOpenSession(storeId);

    try {
      await prisma.$transaction(async (tx) => {
        for (const v of validated) {
          await tx.payment.create({
            data: {
              orderId,
              storeId,
              method: v.method.code,
              amountMinor: v.applied,
              tenderedMinor: v.tendered,
              changeMinor: v.change,
              reference: v.reference,
              idempotencyKey: key,
              note: input.note?.trim() ?? (validated.length > 1 ? `Split payment (${validated.length} tenders)` : null),
              type: "payment",
              createdBy: actorId,
              registerSessionId,
            },
          });
          if (v.method.kind === "CREDIT") {
            // The credit service owns the limit guard + ledger entry (idempotent per order).
            const entry = await this.credit.sellOnCredit(tx as never, storeId, order.storeCustomerId!, orderId, v.applied, actorId);
            if (!entry.ok) {
              const msg = "message" in entry.error ? entry.error.message : "Credit declined";
              throw new Error(msg);
            }
          }
        }
        // Settlement is derived, but the order's own status must still flip to COLLECTED
        // once nothing is outstanding (delivery/POS read that column).
        const netAfter = (before?.paidMinor ?? 0) + appliedTotal - (before?.refundedMinor ?? 0);
        if (netAfter >= order.totalMinor) {
          await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "COLLECTED" } });
        }
        if (validated.length === 1) {
          await tx.order.update({ where: { id: orderId }, data: { paymentMethod: validated[0]!.method.kind === "CREDIT" ? "credit" : validated[0]!.method.kind === "CASH" ? "cash" : validated[0]!.method.code } });
        }
      }, { timeout: 30_000 });
    } catch (e) {
      // Nothing partial survives (the transaction rolled back) — surface a clean
      // conflict instead of a 500 (credit limit, ledger guard, unique violations).
      const msg = e instanceof Error ? e.message : "Payment could not be recorded";
      return { ok: false, error: { type: "conflict", message: msg } };
    }

    const summary = await this.summaryFor(storeId, orderId);
    return summary ? { ok: true, value: summary } : { ok: false, error: { type: "not_found", message: "Order not found" } };
  }
}