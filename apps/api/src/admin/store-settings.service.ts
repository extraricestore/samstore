// Store settings admin service — tenant-scoped store configuration.

import { prisma } from "../persistence/prisma-repositories.js";
import type { ApiError } from "@sam-store/contracts";

export type AdminResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface StoreSettingsInput {
  allowGuestOrders?: boolean;
  orderingPaused?: boolean;
  closedStoreMessage?: string | null;
  minOrderAmountMinor?: number;
  deliveryFeeMinor?: number;
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
  orderCutoff?: string | null;
  maxOpenOrdersPerCustomer?: number;
}

export class StoreSettingsService {
  /** Read store + settings (for the admin settings page). */
  async get(storeId: string) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: { settings: true, publicLink: { select: { slug: true, token: true, status: true } } },
    });
    if (!store) return null;
    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      currencyCode: store.currencyCode,
      timezone: store.timezone,
      status: store.status,
      publicLink: store.publicLink,
      settings: {
        allowGuestOrders: store.settings?.allowGuestOrders ?? true,
        orderingPaused: store.settings?.orderingPaused ?? false,
        closedStoreMessage: store.settings?.closedStoreMessage ?? null,
        minOrderAmountMinor: store.settings?.minOrderAmountMinor ?? 0,
        deliveryFeeMinor: store.settings?.deliveryFeeMinor ?? 0,
        deliveryEnabled: store.settings?.deliveryEnabled ?? true,
        pickupEnabled: store.settings?.pickupEnabled ?? false,
        orderCutoff: store.settings?.orderCutoff ?? null,
        maxOpenOrdersPerCustomer: store.settings?.maxOpenOrdersPerCustomer ?? 10,
      },
    };
  }

  /** Update store settings (upserts the settings row). */
  async update(storeId: string, input: StoreSettingsInput): Promise<AdminResult<{ id: string }>> {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return { ok: false, error: { type: "not_found", message: "Store not found" } };

    // Validate integers where provided.
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "number" && (!Number.isInteger(value) || value < 0)) {
        return { ok: false, error: { type: "validation", errors: [`${key} must be a non-negative integer`] } };
      }
    }
    if (input.orderCutoff !== undefined && input.orderCutoff !== null && !/^\d{2}:\d{2}$/.test(input.orderCutoff)) {
      return { ok: false, error: { type: "validation", errors: ["orderCutoff must be HH:MM (24h)"] } };
    }

    await prisma.storeSettings.upsert({
      where: { storeId },
      update: {
        ...(input.allowGuestOrders !== undefined ? { allowGuestOrders: input.allowGuestOrders } : {}),
        ...(input.orderingPaused !== undefined ? { orderingPaused: input.orderingPaused } : {}),
        ...(input.closedStoreMessage !== undefined ? { closedStoreMessage: input.closedStoreMessage } : {}),
        ...(input.minOrderAmountMinor !== undefined ? { minOrderAmountMinor: input.minOrderAmountMinor } : {}),
        ...(input.deliveryFeeMinor !== undefined ? { deliveryFeeMinor: input.deliveryFeeMinor } : {}),
        ...(input.deliveryEnabled !== undefined ? { deliveryEnabled: input.deliveryEnabled } : {}),
        ...(input.pickupEnabled !== undefined ? { pickupEnabled: input.pickupEnabled } : {}),
        ...(input.orderCutoff !== undefined ? { orderCutoff: input.orderCutoff } : {}),
        ...(input.maxOpenOrdersPerCustomer !== undefined ? { maxOpenOrdersPerCustomer: input.maxOpenOrdersPerCustomer } : {}),
      },
      create: {
        storeId,
        allowGuestOrders: input.allowGuestOrders ?? true,
        orderingPaused: input.orderingPaused ?? false,
        closedStoreMessage: input.closedStoreMessage ?? null,
        minOrderAmountMinor: input.minOrderAmountMinor ?? 0,
        deliveryFeeMinor: input.deliveryFeeMinor ?? 0,
        deliveryEnabled: input.deliveryEnabled ?? true,
        pickupEnabled: input.pickupEnabled ?? false,
        orderCutoff: input.orderCutoff ?? null,
        maxOpenOrdersPerCustomer: input.maxOpenOrdersPerCustomer ?? 10,
      },
    });
    return { ok: true, value: { id: storeId } };
  }
}