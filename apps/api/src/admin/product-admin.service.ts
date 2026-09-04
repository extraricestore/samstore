// Product admin service — tenant-scoped product CRUD + stock.

import { prisma } from "../persistence/prisma-repositories.js";
import { validateProductInput, slugify, type ProductInput } from "../domain/product-validation.js";
import type { ApiError } from "@sam-store/contracts";

export type AdminResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export class ProductAdminService {
  /** List products for a store (with stock + category). */
  async list(storeId: string) {
    return this.listFiltered(storeId, {});
  }

  /** List with filters: search (name/SKU), category, price range, active status. */
  async listFiltered(storeId: string, f: { search?: string; categoryId?: string; minPriceMinor?: number; maxPriceMinor?: number; active?: boolean }) {
    const where: Record<string, unknown> = { storeId };
    if (f.search) {
      where.OR = [
        { name: { contains: f.search, mode: "insensitive" } },
        { sku: { contains: f.search, mode: "insensitive" } },
      ];
    }
    if (f.categoryId) where.categoryId = f.categoryId;
    if (f.minPriceMinor !== undefined || f.maxPriceMinor !== undefined) {
      where.priceMinor = {};
      if (f.minPriceMinor !== undefined) (where.priceMinor as Record<string, unknown>).gte = f.minPriceMinor;
      if (f.maxPriceMinor !== undefined) (where.priceMinor as Record<string, unknown>).lte = f.maxPriceMinor;
    }
    if (f.active !== undefined) where.isActive = f.active;
    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        stockLevels: { select: { quantityOnHand: true, quantityReserved: true, reorderThreshold: true } },
      },
    });
    return products.map((p) => {
      const onHand = p.stockLevels.reduce((s, l) => s + l.quantityOnHand, 0);
      const reserved = p.stockLevels.reduce((s, l) => s + l.quantityReserved, 0);
      return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      priceMinor: p.priceMinor,
      costMinor: p.costMinor,
      isActive: p.isActive,
      category: p.category,
      quantityOnHand: onHand,
      quantityReserved: reserved,
      availableQuantity: onHand - reserved,
      reorderThreshold: p.stockLevels[0]?.reorderThreshold ?? 0,
    };
    });
  }

  /** Create a product (with optional category by slug + initial stock). */
  async create(storeId: string, input: ProductInput): Promise<AdminResult<{ id: string }>> {
    const validation = validateProductInput(input);
    if (!validation.ok) return { ok: false, error: { type: "validation", errors: validation.errors } };

    const existing = await prisma.product.findUnique({
      where: { storeId_sku: { storeId, sku: input.sku.trim() } },
    });
    if (existing) return { ok: false, error: { type: "conflict", message: "A product with this SKU already exists" } };

    let categoryId: string | null = null;
    if (input.categorySlug) {
      const category = await prisma.category.findUnique({
        where: { storeId_slug: { storeId, slug: input.categorySlug } },
      });
      if (!category) return { ok: false, error: { type: "not_found", message: "Category not found" } };
      categoryId = category.id;
    }

    const product = await prisma.product.create({
      data: {
        storeId,
        sku: input.sku.trim(),
        name: input.name.trim(),
        description: input.description?.trim() ?? null,
        priceMinor: input.priceMinor,
        isActive: input.isActive ?? true,
        categoryId,
      },
    });

    // Stock: attach to the store's default warehouse (or a legacy warehouse-less row if none).
    if (input.stock !== undefined) {
      const defaultWarehouse = await prisma.warehouse.findFirst({ where: { storeId, isDefault: true } });
      await prisma.stockLevel.create({
        data: {
          storeId,
          productId: product.id,
          warehouseId: defaultWarehouse?.id ?? null,
          quantityOnHand: input.stock,
        },
      });
    }
    return { ok: true, value: { id: product.id } };
  }

  /** Update a product (price, name, description, stock, category, active). */
  async update(storeId: string, productId: string, input: Partial<ProductInput>): Promise<AdminResult<{ id: string }>> {
    const validation = validateProductInput({
      name: input.name ?? "xx",
      sku: input.sku ?? "xx",
      priceMinor: input.priceMinor ?? 0,
      ...input,
    } as ProductInput);
    if (!validation.ok) return { ok: false, error: { type: "validation", errors: validation.errors } };

    const product = await prisma.product.findFirst({ where: { id: productId, storeId } });
    if (!product) return { ok: false, error: { type: "not_found", message: "Product not found" } };

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          name: input.name?.trim() ?? product.name,
          sku: input.sku?.trim() ?? product.sku,
          description: input.description !== undefined ? input.description?.trim() ?? null : product.description,
          priceMinor: input.priceMinor ?? product.priceMinor,
          isActive: input.isActive ?? product.isActive,
          ...(input.categorySlug !== undefined
            ? { categoryId: input.categorySlug ? (await tx.category.findUnique({ where: { storeId_slug: { storeId, slug: input.categorySlug } } }))?.id ?? null : null }
            : {}),
        },
      });
      if (input.stock !== undefined) {
        // Update stock on the default warehouse (or warehouse-less legacy row) — first match.
        const defaultWarehouse = await tx.warehouse.findFirst({ where: { storeId, isDefault: true } });
        const existing = await tx.stockLevel.findFirst({
          where: { storeId, productId, warehouseId: defaultWarehouse?.id ?? null },
        });
        if (existing) {
          await tx.stockLevel.update({ where: { id: existing.id }, data: { quantityOnHand: input.stock } });
        } else if (defaultWarehouse) {
          await tx.stockLevel.create({ data: { storeId, productId, warehouseId: defaultWarehouse.id, quantityOnHand: input.stock } });
        } else {
          const anyRow = await tx.stockLevel.findFirst({ where: { storeId, productId } });
          if (anyRow) {
            await tx.stockLevel.update({ where: { id: anyRow.id }, data: { quantityOnHand: input.stock } });
          } else {
            await tx.stockLevel.create({ data: { storeId, productId, quantityOnHand: input.stock } });
          }
        }
      }
    });
    return { ok: true, value: { id: productId } };
  }

  /** Soft-delete a product (isActive = false). */
  async remove(storeId: string, productId: string): Promise<AdminResult<{ id: string }>> {
    const product = await prisma.product.findFirst({ where: { id: productId, storeId } });
    if (!product) return { ok: false, error: { type: "not_found", message: "Product not found" } };
    await prisma.product.update({ where: { id: productId }, data: { isActive: false } });
    return { ok: true, value: { id: productId } };
  }

  /** Category helpers (by slug, within store). */
  async listCategories(storeId: string) {
    return prisma.category.findMany({ where: { storeId }, orderBy: { sortOrder: "asc" } });
  }

  async ensureCategory(storeId: string, name: string): Promise<{ id: string }> {
    const slug = slugify(name);
    const category = await prisma.category.upsert({
      where: { storeId_slug: { storeId, slug } },
      update: { name },
      create: { storeId, name, slug },
    });
    return { id: category.id };
  }
}