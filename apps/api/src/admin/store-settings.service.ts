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
  creditLimitMinor?: number; // P11: default utang limit
  receiptHeader?: string | null; // P11
  receiptFooter?: string | null; // P11
  showVatLabel?: boolean; // P11
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
      accentColor: store.accentColor,
      bannerText: store.bannerText,
      shareMessage: store.shareMessage,
      logoUrl: store.logoUrl,
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
        creditLimitMinor: store.settings?.creditLimitMinor ?? 0,
        receiptHeader: store.settings?.receiptHeader ?? null,
        receiptFooter: store.settings?.receiptFooter ?? null,
        showVatLabel: store.settings?.showVatLabel ?? true,
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
        ...(input.creditLimitMinor !== undefined ? { creditLimitMinor: input.creditLimitMinor } : {}),
        ...(input.receiptHeader !== undefined ? { receiptHeader: input.receiptHeader } : {}),
        ...(input.receiptFooter !== undefined ? { receiptFooter: input.receiptFooter } : {}),
        ...(input.showVatLabel !== undefined ? { showVatLabel: input.showVatLabel } : {}),
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
        creditLimitMinor: input.creditLimitMinor ?? 0,
        receiptHeader: input.receiptHeader ?? null,
        receiptFooter: input.receiptFooter ?? null,
        showVatLabel: input.showVatLabel ?? true,
      },
    });
    return { ok: true, value: { id: storeId } };
  }

  /** P8 — store link branding: accent color, banner text, share message, logo. */
  async updateLink(storeId: string, input: { accentColor?: string; bannerText?: string | null; shareMessage?: string | null; logoUrl?: string | null }): Promise<AdminResult<{ id: string }>> {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return { ok: false, error: { type: "not_found", message: "Store not found" } };
    if (input.accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.accentColor)) {
      return { ok: false, error: { type: "validation", errors: ["accentColor must be a hex color (#rrggbb)"] } };
    }
    await prisma.store.update({
      where: { id: storeId },
      data: {
        ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
        ...(input.bannerText !== undefined ? { bannerText: input.bannerText } : {}),
        ...(input.shareMessage !== undefined ? { shareMessage: input.shareMessage } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      },
    });
    return { ok: true, value: { id: storeId } };
  }
}