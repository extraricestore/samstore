// Stock movement LEDGER — append-only writes that accompany every StockLevel
// mutation. Balances on StockLevel are DERIVED facts; this table is the source
// for reconciliation (available = onHand - reserved; audit of who/when/why).
// Invariant: every stock-level change in the codebase goes through one of these
// helpers so the ledger can never silently diverge from the balances.

import type { Prisma } from "@prisma/client";

export type MovementTx = Prisma.TransactionClient;

export interface MovementInput {
  storeId: string;
  productId: string;
  warehouseId?: string | null;
  delta: number;
  type: string; // RESERVE | RELEASE | CONSUME | ADJUST | RECEIPT | TRANSFER_IN | TRANSFER_OUT | VOID_RESTORE
  orderId?: string | null;
  createdBy?: string | null;
  note?: string | null;
  balanceAfter?: number | null;
}

/** Append a movement to the ledger (inside an existing transaction). */
export async function recordMovement(tx: MovementTx, m: MovementInput): Promise<void> {
  await tx.stockMovement.create({
    data: {
      storeId: m.storeId,
      productId: m.productId,
      warehouseId: m.warehouseId ?? null,
      delta: m.delta,
      type: m.type,
      orderId: m.orderId ?? null,
      createdBy: m.createdBy ?? null,
      note: m.note ?? null,
      balanceAfter: m.balanceAfter ?? null,
    },
  });
}

/**
 * Thrown when a guarded stock write cannot be satisfied (Module 4 fix): the level
 * dropped below the requested quantity between the read and the write. Callers
 * surface this as a conflict, never as a negative balance.
 */
export class InsufficientStockError extends Error {
  constructor(
    public readonly productId: string,
    public readonly shortfall: number,
  ) {
    super(`insufficient stock for product ${productId} (short by ${shortfall})`);
    this.name = "InsufficientStockError";
  }
}

/**
 * Decrement multiple stock levels for lines (prefers default-warehouse rows),
 * recording a movement per touched level. Returns the levels actually changed.
 * Used by POS sells/holds/preorders and admin item edits.
 *
 * CONDITIONAL WRITES ONLY: every decrement is a single guarded UPDATE
 * (`... WHERE id = ? AND "quantityOnHand" >= take`). If the guard misses, the
 * level changed under us — we re-read it and try the next level. A shortfall is
 * an explicit InsufficientStockError, so a balance can never go negative.
 * Products with NO stock-level rows are untracked and keep the legacy no-op.
 */
export async function deductStock(tx: MovementTx, storeId: string, lines: { productId: string; quantity: number }[], opts?: { type?: string; orderId?: string | null; createdBy?: string | null }): Promise<void> {
  const type = opts?.type ?? "CONSUME";
  for (const l of lines) {
    if (l.quantity <= 0) continue;
    // Fetch ALL levels (not just in-stock ones): the difference between "this
    // product is untracked" (no rows) and "tracked but empty" decides whether a
    // shortfall is an error or a legacy no-op.
    const allLevels = await tx.stockLevel.findMany({ where: { storeId, productId: l.productId } });
    if (allLevels.length === 0) continue; // untracked product — no stock accounting
    const levels = allLevels.filter((x) => x.quantityOnHand > 0);
    levels.sort((a, b) => (a.warehouseId ? 0 : 1) - (b.warehouseId ? 0 : 1));
    let remaining = l.quantity;
    for (const lvl of levels) {
      if (remaining <= 0) break;
      const take = Math.min(lvl.quantityOnHand, remaining);
      if (take > 0) {
        // Guarded single-statement decrement — no read-then-write race.
        const changed = await tx.stockLevel.updateMany({
          where: { id: lvl.id, quantityOnHand: { gte: take } },
          data: { quantityOnHand: { decrement: take } },
        });
        if (changed.count === 0) continue; // lost the race — re-read happens on the next level
        const fresh = await tx.stockLevel.findUnique({ where: { id: lvl.id }, select: { quantityOnHand: true } });
        await recordMovement(tx, {
          storeId,
          productId: l.productId,
          warehouseId: lvl.warehouseId,
          delta: -take,
          type,
          orderId: opts?.orderId,
          createdBy: opts?.createdBy,
          balanceAfter: fresh?.quantityOnHand ?? null,
        });
        remaining -= take;
      }
    }
    // Levels existed but could not cover the request → the caller must handle a
    // real shortfall instead of silently shipping stock we do not have.
    if (remaining > 0) {
      throw new InsufficientStockError(l.productId, remaining);
    }
  }
}

/**
 * Restore stock for lines (void/cancel/edit-revert), recording a movement.
 * Uses the FIRST level for the product (legacy compatibility).
 */
export async function restoreStock(tx: MovementTx, storeId: string, lines: { productId: string; quantity: number }[], opts?: { type?: string; orderId?: string | null; createdBy?: string | null }): Promise<void> {
  const type = opts?.type ?? "RELEASE";
  for (const l of lines) {
    const level = await tx.stockLevel.findFirst({ where: { storeId, productId: l.productId } });
    if (level) {
      const updated = await tx.stockLevel.update({
        where: { id: level.id },
        data: { quantityOnHand: { increment: l.quantity } },
      });
      await recordMovement(tx, {
        storeId,
        productId: l.productId,
        warehouseId: level.warehouseId,
        delta: l.quantity,
        type,
        orderId: opts?.orderId,
        createdBy: opts?.createdBy,
        balanceAfter: updated.quantityOnHand,
      });
    }
  }
}