// Inventory: aggregated per product across warehouses, with filters + value at cost.
// Filters: search (name/SKU), category, warehouse, stock status (in/low/out).
// Inventory value = Σ costMinor × quantityOnHand (cost from latest purchase).

import { prisma } from "../persistence/prisma-repositories.js";

export const INVENTORY_SERVICE = Symbol("INVENTORY_SERVICE");

export class InventoryService {
  async list(storeId: string, filters: { search?: string; categoryId?: string; warehouseId?: string; status?: "in" | "low" | "out" } = {}) {
    const where: Record<string, unknown> = { storeId, isActive: true };
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { sku: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    if (filters.categoryId) where.categoryId = filters.categoryId;

    const products = await prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        stockLevels: true,
      },
      orderBy: { name: "asc" },
    });

    const rows = products.map((p) => {
      const levels = filters.warehouseId ? p.stockLevels.filter((l) => l.warehouseId === filters.warehouseId) : p.stockLevels;
      const onHand = levels.reduce((s, l) => s + l.quantityOnHand, 0);
      const reserved = levels.reduce((s, l) => s + l.quantityReserved, 0);
      const threshold = Math.max(0, ...levels.map((l) => l.reorderThreshold));
      const available = onHand - reserved;
      let status: "in" | "low" | "out";
      if (available <= 0 && onHand <= 0) status = "out";
      else if (threshold > 0 && available <= threshold) status = "low";
      else status = "in";
      const valueMinor = onHand * p.costMinor;
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category?.name ?? null,
        quantityOnHand: onHand,
        quantityReserved: reserved,
        availableQuantity: available,
        reorderThreshold: threshold,
        costMinor: p.costMinor,
        valueMinor,
        status,
      };
    });

    const filtered = filters.status ? rows.filter((r) => r.status === filters.status) : rows;
    const totalValueMinor = filtered.reduce((s, r) => s + r.valueMinor, 0);
    return { items: filtered, totalValueMinor, count: filtered.length };
  }
}