// Prisma-backed implementations of the repository interfaces.
// Swap target for the in-memory repos once DATABASE_URL is live. Callers depend
// only on the interfaces, so no service changes are required.

import { PrismaClient } from "@prisma/client";
import type {
  StoreRecord,
  ProductRecord,
  CartRecord,
  OrderRecord,
  StoreRepository,
  CatalogRepository,
  CartRepository,
  OrderRepository,
  OrderSequenceRepository,
} from "./repositories.js";
import { OrderStatus, PaymentStatus } from "@prisma/client";

export const prisma = new PrismaClient();

export const ORDER_SEQUENCE_KIND = "ORDER_SEQ";
export const CLAIM_TOKEN_TTL_DAYS = 30;

type StoreWithSettings = NonNullable<Awaited<ReturnType<PrismaClient["store"]["findUnique"]>>> & {
  settings: {
    allowGuestOrders: boolean;
    orderingPaused: boolean;
    closedStoreMessage: string | null;
    deliveryFeeMinor: number;
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    minOrderAmountMinor: number;
  } | null;
};

export class PrismaStoreRepository implements StoreRepository {
  private static toRecord(s: StoreWithSettings | null): StoreRecord | null {
    if (!s) return null;
    const settings = s.settings;
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      currencyCode: s.currencyCode,
      timezone: s.timezone,
      status: s.status,
      guestOrderingEnabled: settings?.allowGuestOrders ?? true,
      orderingPaused: settings?.orderingPaused ?? false,
      closedStoreMessage: settings?.closedStoreMessage ?? null,
      deliveryFeeMinor: settings?.deliveryFeeMinor ?? 0,
      deliveryEnabled: settings?.deliveryEnabled ?? true,
      pickupEnabled: settings?.pickupEnabled ?? false,
      minOrderAmountMinor: settings?.minOrderAmountMinor ?? 0,
    };
  }

  async findBySlug(slug: string): Promise<StoreRecord | null> {
    const s = await prisma.store.findUnique({
      where: { slug },
      include: { settings: true },
    });
    return PrismaStoreRepository.toRecord(s);
  }

  async findById(id: string): Promise<StoreRecord | null> {
    const s = await prisma.store.findUnique({
      where: { id },
      include: { settings: true },
    });
    return PrismaStoreRepository.toRecord(s);
  }
}

export class PrismaCatalogRepository implements CatalogRepository {
  private static toRecord(
    p: Awaited<ReturnType<PrismaClient["product"]["findFirst"]>> & {
      category: { name: string } | null;
      images: { url: string; sortOrder: number }[];
      stockLevel: { quantityOnHand: number; quantityReserved: number } | null;
    },
  ): ProductRecord {
    return {
      id: p.id,
      storeId: p.storeId,
      sku: p.sku,
      name: p.name,
      description: p.description,
      priceMinor: p.priceMinor,
      isActive: p.isActive,
      categoryName: p.category?.name ?? null,
      images: p.images.map((i) => i.url),
      quantityOnHand: p.stockLevel?.quantityOnHand ?? 0,
      quantityReserved: p.stockLevel?.quantityReserved ?? 0,
    };
  }

  async listActiveProducts(storeId: string): Promise<ProductRecord[]> {
    const rows = await prisma.product.findMany({
      where: { storeId, isActive: true },
      include: {
        category: { select: { name: true } },
        images: { orderBy: { sortOrder: "asc" }, select: { url: true, sortOrder: true } },
        stockLevel: { select: { quantityOnHand: true, quantityReserved: true } },
      },
    });
    return rows.map(PrismaCatalogRepository.toRecord);
  }

  async getProductsByIds(storeId: string, ids: string[]): Promise<ProductRecord[]> {
    const rows = await prisma.product.findMany({
      where: { storeId, id: { in: ids } },
      include: {
        category: { select: { name: true } },
        images: { orderBy: { sortOrder: "asc" }, select: { url: true, sortOrder: true } },
        stockLevel: { select: { quantityOnHand: true, quantityReserved: true } },
      },
    });
    return rows.map(PrismaCatalogRepository.toRecord);
  }

  async getProductById(id: string): Promise<ProductRecord | null> {
    const row = await prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { name: true } },
        images: { orderBy: { sortOrder: "asc" }, select: { url: true, sortOrder: true } },
        stockLevel: { select: { quantityOnHand: true, quantityReserved: true } },
      },
    });
    return row ? PrismaCatalogRepository.toRecord(row) : null;
  }
}

export class PrismaCartRepository implements CartRepository {
  async findByToken(token: string): Promise<CartRecord | null> {
    const c = await prisma.cart.findUnique({
      where: { token },
      include: {
        items: { include: { product: { select: { id: true } } } },
      },
    });
    if (!c) return null;
    return {
      id: c.id,
      storeId: c.storeId ?? "",
      token: c.token,
      status: c.status,
      lines: c.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPriceMinor: i.unitPriceMinor,
      })),
    };
  }

  async create(cart: CartRecord): Promise<CartRecord> {
    await prisma.cart.create({
      data: {
        id: cart.id,
        storeId: cart.storeId || null,
        token: cart.token,
        status: cart.status,
      },
    });
    return cart;
  }

  async addItem(cartId: string, storeId: string, productId: string, quantity: number, unitPriceMinor: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.cartItem.findUnique({
        where: { cartId_productId: { cartId, productId } },
      });
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + quantity },
        });
      } else {
        await tx.cartItem.create({
          data: { cartId, storeId, productId, quantity, unitPriceMinor },
        });
      }
    });
  }

  async updateItemQuantity(cartId: string, productId: string, quantity: number): Promise<void> {
    await prisma.cartItem.update({
      where: { cartId_productId: { cartId, productId } },
      data: { quantity },
    });
  }

  async removeItem(cartId: string, productId: string): Promise<void> {
    await prisma.cartItem.deleteMany({
      where: { cartId, productId },
    });
  }

  async save(cart: CartRecord): Promise<void> {
    // Replace line items + status atomically (status transition e.g. OPEN → CONVERTED).
    await prisma.$transaction(async (tx) => {
      await tx.cart.update({
        where: { id: cart.id },
        data: { status: cart.status, ...(cart.storeId ? { storeId: cart.storeId } : {}) },
      });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      if (cart.lines.length > 0) {
        await tx.cartItem.createMany({
          data: cart.lines.map((l) => ({
            cartId: cart.id,
            storeId: cart.storeId,
            productId: l.productId,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
          })),
        });
      }
    });
  }
}

export class PrismaOrderSequenceRepository implements OrderSequenceRepository {
  async nextOrderSequence(storeId: string): Promise<number> {
    const counter = await prisma.storeCounter.upsert({
      where: { storeId_kind: { storeId, kind: ORDER_SEQUENCE_KIND } },
      update: { value: { increment: 1 } },
      create: { storeId, kind: ORDER_SEQUENCE_KIND, value: 1 },
    });
    return counter.value;
  }
}

export class PrismaOrderRepository implements OrderRepository {
  private static toRecord(
    o: Awaited<ReturnType<PrismaClient["order"]["findFirst"]>> & {
      items: {
        productId: string | null;
        productName: string;
        sku: string;
        unitPriceMinor: number;
        quantity: number;
        lineTotalMinor: number;
      }[];
      claimTokens: { token: string; usedAt: Date | null }[];
    },
  ): OrderRecord {
    const liveClaim = o.claimTokens
      .filter((t) => !t.usedAt)
      .sort((a, b) => (a.token < b.token ? -1 : 1))[0];
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      storeId: o.storeId,
      status: o.status,
      currencyCode: o.currencyCode,
      subtotalMinor: o.subtotalMinor,
      deliveryFeeMinor: o.deliveryFeeMinor,
      discountMinor: o.discountMinor,
      totalMinor: o.totalMinor,
      snapshot: o.snapshot,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      idempotencyKey: o.idempotencyKey ?? "",
      cartToken: o.cartToken,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      deliveryAddressLine1: o.deliveryAddressLine1,
      deliveryAddressLine2: o.deliveryAddressLine2,
      landmark: o.landmark,
      deliverySchedule: o.deliverySchedule,
      notes: o.notes,
      claimToken: liveClaim?.token ?? null,
      items: o.items,
      createdAt: o.createdAt,
    };
  }

  async create(order: OrderRecord): Promise<OrderRecord> {
    const created = await prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          id: order.id,
          orderNumber: order.orderNumber,
          storeId: order.storeId,
          status: order.status as OrderStatus,
          currencyCode: order.currencyCode,
          subtotalMinor: order.subtotalMinor,
          deliveryFeeMinor: order.deliveryFeeMinor,
          discountMinor: order.discountMinor,
          totalMinor: order.totalMinor,
          snapshot: order.snapshot as object,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus as PaymentStatus,
          idempotencyKey: order.idempotencyKey,
          cartToken: order.cartToken,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          deliveryAddressLine1: order.deliveryAddressLine1,
          deliveryAddressLine2: order.deliveryAddressLine2,
          landmark: order.landmark,
          deliverySchedule: order.deliverySchedule,
          notes: order.notes,
        },
      });

      if (order.items.length > 0) {
        await tx.orderItem.createMany({
          data: order.items.map((i) => ({
            orderId: o.id,
            storeId: order.storeId,
            productId: i.productId,
            productName: i.productName,
            sku: i.sku,
            unitPriceMinor: i.unitPriceMinor,
            quantity: i.quantity,
            lineTotalMinor: i.lineTotalMinor,
          })),
        });
      }

      await tx.orderStatusHistory.create({
        data: {
          orderId: o.id,
          storeId: order.storeId,
          toStatus: order.status as OrderStatus,
          actorType: "system",
        },
      });

      if (order.claimToken) {
        await tx.orderClaimToken.create({
          data: {
            orderId: o.id,
            storeId: order.storeId,
            token: order.claimToken,
            expiresAt: new Date(Date.now() + CLAIM_TOKEN_TTL_DAYS * 86_400_000),
          },
        });
      }

      return o;
    });

    return {
      ...order,
      id: created.id,
    };
  }

  async findByIdempotencyKey(key: string): Promise<OrderRecord | null> {
    const o = await prisma.order.findUnique({
      where: { idempotencyKey: key },
      include: {
        items: true,
        claimTokens: { select: { token: true, usedAt: true } },
      },
    });
    return o ? PrismaOrderRepository.toRecord(o) : null;
  }

  async markClaimTokenUsed(orderId: string, token: string): Promise<void> {
    await prisma.orderClaimToken.updateMany({
      where: { orderId, token },
      data: { usedAt: new Date() },
    });
  }
}