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
 * Decrement multiple stock levels for lines (prefers default-warehouse rows),
 * recording a movement per touched level. Returns the levels actually changed.
 * Used by POS sells/holds/preorders and admin item edits.
 */
export async function deductStock(tx: MovementTx, storeId: string, lines: { productId: string; quantity: number }[], opts?: { type?: string; orderId?: string | null; createdBy?: string | null }): Promise<void> {
  const type = opts?.type ?? "CONSUME";
  for (const l of lines) {
    const levels = await tx.stockLevel.findMany({ where: { storeId, productId: l.productId, quantityOnHand: { gt: 0 } } });
    levels.sort((a, b) => (a.warehouseId ? 0 : 1) - (b.warehouseId ? 0 : 1));
    let remaining = l.quantity;
    for (const lvl of levels) {
      if (remaining <= 0) break;
      const take = Math.min(lvl.quantityOnHand, remaining);
      if (take > 0) {
        const updated = await tx.stockLevel.update({
          where: { id: lvl.id },
          data: { quantityOnHand: { decrement: take } },
        });
        await recordMovement(tx, {
          storeId,
          productId: l.productId,
          warehouseId: lvl.warehouseId,
          delta: -take,
          type,
          orderId: opts?.orderId,
          createdBy: opts?.createdBy,
          balanceAfter: updated.quantityOnHand,
        });
        remaining -= take;
      }
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