// Repository contracts (domain-facing) + InMemory implementations.
// The NestJS modules depend on these INTERFACES; Prisma-backed implementations
// will replace InMemoryRepository once DATABASE_URL is live — no service changes needed.

export interface StoreRecord {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  currencyCode: string;
  timezone: string;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED" | "CLOSED";
  guestOrderingEnabled: boolean;
  orderingPaused: boolean;
  closedStoreMessage: string | null;
  deliveryFeeMinor: number;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  minOrderAmountMinor: number;
  accentColor?: string | null;
  bannerText?: string | null;
  logoUrl?: string | null;
}

export interface ProductRecord {
  id: string;
  storeId: string;
  sku: string;
  name: string;
  description: string | null;
  priceMinor: number;
  isActive: boolean;
  categoryName: string | null;
  images: string[];
  quantityOnHand: number;
  quantityReserved: number;
}

export interface CartLineRecord {
  productId: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface CartRecord {
  id: string;
  storeId: string;
  token: string;
  status: "OPEN" | "CONVERTED" | "ABANDONED" | "EXPIRED";
  expiresAt?: Date | null;
  lines: CartLineRecord[];
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  storeId: string;
  status: string;
  currencyCode: string;
  deliveryType?: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  snapshot: unknown;
  paymentMethod: string;
  paymentStatus: string;
  idempotencyKey: string;
  cartToken: string;
  storeCustomerId?: string | null;
  customerName: string;
  customerPhone: string;
  deliveryAddressLine1: string;
  deliveryAddressLine2: string | null;
  landmark: string | null;
  deliverySchedule: string | null;
  notes: string | null;
  claimToken: string | null;
  items: {
    productId: string | null;
    productName: string;
    sku: string;
    unitPriceMinor: number;
    quantity: number;
    lineTotalMinor: number;
  }[];
  createdAt: Date;
}

export interface StoreRepository {
  findBySlug(slug: string): Promise<StoreRecord | null>;
  findById(id: string): Promise<StoreRecord | null>;
}

export interface CatalogRepository {
  listActiveProducts(storeId: string): Promise<ProductRecord[]>;
  getProductsByIds(storeId: string, ids: string[]): Promise<ProductRecord[]>;
  /** Cross-store lookup — used only to bind a fresh cart to the product's store on first add. */
  getProductById(id: string): Promise<ProductRecord | null>;
}

export interface CartRepository {
  findByToken(token: string): Promise<CartRecord | null>;
  /** Create a cart (must be unique token); storeId bound on first add. */
  create(cart: CartRecord): Promise<CartRecord>;
  /** Add a line; upserts quantity when the product is already in the cart. */
  addItem(cartId: string, storeId: string, productId: string, quantity: number, unitPriceMinor: number): Promise<void>;
  updateItemQuantity(cartId: string, productId: string, quantity: number): Promise<void>;
  removeItem(cartId: string, productId: string): Promise<void>;
  save(cart: CartRecord): Promise<void>;
}

export interface OrderSequenceRepository {
  nextOrderSequence(storeId: string): Promise<number>;
}

export interface OrderRepository {
  create(order: OrderRecord): Promise<OrderRecord>;
  findByIdempotencyKey(key: string): Promise<OrderRecord | null>;
  markClaimTokenUsed(orderId: string, token: string): Promise<void>;
}

// ─────────────────────────────── InMemory ───────────────────────────────

import { randomUUID } from "node:crypto";

export class InMemoryStoreRepository implements StoreRepository {
  private store = new Map<string, StoreRecord>();

  seed(...stores: StoreRecord[]) {
    for (const s of stores) {
      this.store.set(s.slug, s);
      this.store.set(s.id, s);
    }
  }

  async findBySlug(slug: string): Promise<StoreRecord | null> {
    return this.store.get(slug) ?? null;
  }
  async findById(id: string): Promise<StoreRecord | null> {
    return this.store.get(id) ?? null;
  }
}

export class InMemoryCatalogRepository implements CatalogRepository {
  private byId = new Map<string, ProductRecord>();

  seed(...products: ProductRecord[]) {
    for (const p of products) this.byId.set(p.id, p);
  }

  async listActiveProducts(storeId: string): Promise<ProductRecord[]> {
    return [...this.byId.values()].filter(
      (p) => p.storeId === storeId && p.isActive,
    );
  }
  async getProductsByIds(storeId: string, ids: string[]): Promise<ProductRecord[]> {
    return ids
      .map((id) => this.byId.get(id))
      .filter((p): p is ProductRecord => !!p && p.storeId === storeId);
  }
  async getProductById(id: string): Promise<ProductRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

export class InMemoryCartRepository implements CartRepository {
  private byToken = new Map<string, CartRecord>();

  seed(...carts: CartRecord[]) {
    for (const c of carts) this.byToken.set(c.token, c);
  }

  async findByToken(token: string): Promise<CartRecord | null> {
    return this.byToken.get(token) ?? null;
  }
  async create(cart: CartRecord): Promise<CartRecord> {
    this.byToken.set(cart.token, cart);
    return cart;
  }
  async addItem(cartId: string, storeId: string, productId: string, quantity: number, unitPriceMinor: number): Promise<void> {
    const cart = [...this.byToken.values()].find((c) => c.id === cartId);
    if (!cart) return;
    const existing = cart.lines.find((l) => l.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.lines.push({ productId, quantity, unitPriceMinor });
    }
  }
  async updateItemQuantity(cartId: string, productId: string, quantity: number): Promise<void> {
    const cart = [...this.byToken.values()].find((c) => c.id === cartId);
    const line = cart?.lines.find((l) => l.productId === productId);
    if (line) line.quantity = quantity;
  }
  async removeItem(cartId: string, productId: string): Promise<void> {
    const cart = [...this.byToken.values()].find((c) => c.id === cartId);
    if (cart) cart.lines = cart.lines.filter((l) => l.productId !== productId);
  }
  async save(cart: CartRecord): Promise<void> {
    this.byToken.set(cart.token, cart);
  }
}

export class InMemoryOrderSequenceRepository implements OrderSequenceRepository {
  private seq = new Map<string, number>();
  async nextOrderSequence(storeId: string): Promise<number> {
    const next = (this.seq.get(storeId) ?? 0) + 1;
    this.seq.set(storeId, next);
    return next;
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  private orders: OrderRecord[] = [];
  private byIdem = new Map<string, OrderRecord>();
  private usedClaimTokens = new Set<string>();

  seed(...orders: OrderRecord[]) {
    for (const o of orders) {
      this.orders.push(o);
      this.byIdem.set(o.idempotencyKey, o);
    }
  }

  async create(order: OrderRecord): Promise<OrderRecord> {
    this.orders.push(order);
    this.byIdem.set(order.idempotencyKey, order);
    return order;
  }
  async findByIdempotencyKey(key: string): Promise<OrderRecord | null> {
    return this.byIdem.get(key) ?? null;
  }
  async markClaimTokenUsed(orderId: string, token: string): Promise<void> {
    this.usedClaimTokens.add(`${orderId}:${token}`);
  }
  exportedForTests() {
    return { orders: [...this.orders], usedClaimTokens: [...this.usedClaimTokens] };
  }
}

export function randomId(): string {
  return randomUUID();
}