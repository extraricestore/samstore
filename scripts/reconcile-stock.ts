// Stock reconciliation (Module 11) — dry-run by default.
// Verifies each StockLevel against its movement ledger:
//   impliedInitial = (balanceAfter of FIRST movement) - (delta of first movement)
//   expectedOnHand = impliedInitial + sum(all movement deltas)
//   drift = current onHand - expectedOnHand
// A non-zero drift means the ledger and the balance disagree. `--apply` writes a
// correction ADJUST movement (and fixes the balance) so the ledger becomes the
// source of truth again. Levels with NO movements can't be validated this way and
// are skipped (they predate Module 4's ledger).
//
// Usage: npx tsx scripts/reconcile-stock.ts [--apply] [--store <id>]

import { prisma } from "../apps/api/src/persistence/prisma-repositories.js";

async function main() {
  const apply = process.argv.includes("--apply");
  const storeArgIdx = process.argv.indexOf("--store");
  const storeFilter = storeArgIdx > -1 ? process.argv[storeArgIdx + 1] : undefined;

  const levels = await prisma.stockLevel.findMany({
    where: storeFilter ? { storeId: storeFilter } : {},
    include: { product: { select: { name: true, sku: true } }, store: { select: { slug: true } } },
  });

  let checked = 0;
  let driftFound = 0;
  for (const level of levels) {
    const movements = await prisma.stockMovement.findMany({
      where: { productId: level.productId, warehouseId: level.warehouseId ?? null, storeId: level.storeId },
      orderBy: { createdAt: "asc" },
    });
    if (movements.length === 0) continue; // predates the ledger
    checked += 1;

    const first = movements[0]!;
    const impliedInitial = first.balanceAfter !== null ? first.balanceAfter - first.delta : null;
    const sumDelta = movements.reduce((s, m) => s + m.delta, 0);
    const expected = impliedInitial !== null ? impliedInitial + sumDelta : null;
    if (expected === null) continue;
    const drift = level.quantityOnHand - expected;

    if (drift !== 0) {
      driftFound += 1;
      console.log(`DRIFT ${level.store.slug}/${level.product.sku}: onHand=${level.quantityOnHand} ledger=${expected} delta=${drift} (${level.product.name})`);
      if (apply) {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.stockLevel.update({ where: { id: level.id }, data: { quantityOnHand: expected } });
          await tx.stockMovement.create({
            data: {
              storeId: level.storeId,
              productId: level.productId,
              warehouseId: level.warehouseId,
              delta: -drift,
              type: "ADJUST",
              orderId: null,
              createdBy: "reconcile",
              note: "reconciliation correction",
              balanceAfter: updated.quantityOnHand,
            },
          });
        });
        console.log(`  -> corrected to ${expected} + ADJUST movement`);
      }
    }
  }

  console.log(`\nlevels checked: ${checked}${driftFound ? ` · DRIFT found: ${driftFound}${apply ? " · corrected" : " (run with --apply to fix)"}` : " · all in sync"}`);
  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
