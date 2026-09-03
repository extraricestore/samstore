// @sam-store/contracts — shared domain types & DTOs.
// Single source of truth for the Thin Slice API surface.
// Money: integer minor units (cents) everywhere — never floats.

// ─────────────────────────────── Catalog ───────────────────────────────

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
}

export interface ProductDTO {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  /** integer minor units */
  priceMinor: number;
  category: CategoryDTO | null;
  images: { url: string; sortOrder: number }[];
  /** quantityOnHand minus quantityReserved; null when unlimited */
  availableQuantity: number | null;
}

export interface PublicStoreDTO {
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  currencyCode: string;
  timezone: string;
  /** true when the store accepts guest orders via the public link */
  guestOrderingEnabled: boolean;
  orderingPaused: boolean;
  closedStoreMessage: string | null;
  deliveryFeeMinor: number;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  minOrderAmountMinor: number;
}

// ─────────────────────────────── Cart ───────────────────────────────

export interface CartLineDTO {
  productId: string;
  sku: string;
  name: string;
  /** snapshot of unit price at add-time, integer minor units */
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export interface CartDTO {
  token: string;
  storeId: string;
  lines: CartLineDTO[];
  subtotalMinor: number;
}

/** Result of server-side revalidation before checkout (AGENTS.md: never charge a stale total). */
export interface CartRevalidationDTO {
  lines: CartLineDTO[];
  subtotalMinor: number;
  /** products whose price changed since added; new prices already applied */
  priceChanges: { productId: string; fromMinor: number; toMinor: number }[];
  /** inactive/removed products dropped from the cart */
  removedProductIds: string[];
}

export interface AddToCartRequest {
  productId: string;
  quantity: number;
}

export interface UpdateCartItemRequest {
  quantity: number;
}

export interface CreateCartResponse {
  token: string;
}

export interface CartItemDTO {
  productId: string;
  sku: string;
  name: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export interface CartWithItemsDTO {
  token: string;
  storeId: string;
  status: "OPEN" | "CONVERTED" | "ABANDONED" | "EXPIRED";
  items: CartItemDTO[];
  subtotalMinor: number;
}

// ─────────────────────────────── Checkout (COD, slice scope) ───────────────────────────────

export interface CheckoutRequest {
  cartToken: string;
  customerName: string;
  customerPhone: string;
  deliveryAddressLine1: string;
  deliveryAddressLine2?: string;
  landmark?: string;
  deliverySchedule?: string;
  notes?: string;
  /** slice scope: "cod" only; any other value rejected server-side */
  paymentMethod: "cod";
  /** client-generated; same value on retry → same order, no duplicates */
  idempotencyKey: string;
}

export interface CheckoutResponse {
  orderId: string;
  orderNumber: string;
  status: "RECEIVED";
  totalMinor: number;
  currencyCode: string;
  /** temporary claim token so the guest can reopen the order; single-use */
  claimToken: string;
}

export interface OrderViewDTO {
  orderNumber: string;
  status: string;
  currencyCode: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
  customerName: string;
  customerPhone: string;
  deliveryAddressLine1: string;
  deliveryAddressLine2: string | null;
  landmark: string | null;
  deliverySchedule: string | null;
  notes: string | null;
  items: {
    productName: string;
    sku: string;
    unitPriceMinor: number;
    quantity: number;
    lineTotalMinor: number;
  }[];
  createdAt: string;
}

// ─────────────────────────────── Errors ───────────────────────────────

export type ApiError =
  | { type: "validation"; errors: string[] }
  | { type: "not_found"; message: string }
  | { type: "conflict"; message: string }
  | { type: "forbidden"; message: string }
  | { type: "unauthorized"; message: string }
  | { type: "rate_limited"; message: string };

export const PAYMENT_METHODS = ["cod"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_STATUSES = [
  "RECEIVED",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "FAILED_DELIVERY",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];