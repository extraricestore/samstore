// Product admin service — tenant-scoped product CRUD + stock.

import { prisma } from "../persistence/prisma-repositories.js";
import { validateProductInput, slugify, type ProductInput } from "../domain/product-validation.js";
import type { ApiError } from "@sam-store/contracts";

export type AdminResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export class ProductAdminService {
  /** List products for a store (with stock + category). */
  async list(storeId: string) {
    const products = await prisma.product.findMany({
      where: { storeId },
      orderBy: { createdAt: "asc" },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        stockLevel: { select: { quantityOnHand: true, quantityReserved: true, reorderThreshold: true } },
      },
    });
    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      priceMinor: p.priceMinor,
      isActive: p.isActive,
      category: p.category,
      quantityOnHand: p.stockLevel?.quantityOnHand ?? 0,
      quantityReserved: p.stockLevel?.quantityReserved ?? 0,
      availableQuantity: (p.stockLevel?.quantityOnHand ?? 0) - (p.stockLevel?.quantityReserved ?? 0),
      reorderThreshold: p.stockLevel?.reorderThreshold ?? 0,
    }));
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
        ...(input.stock !== undefined
          ? { stockLevel: { create: { storeId, quantityOnHand: input.stock } } }
          : {}),
      },
    });
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
        await tx.stockLevel.upsert({
          where: { productId },
          update: { quantityOnHand: input.stock, storeId },
          create: { productId, storeId, quantityOnHand: input.stock },
        });
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