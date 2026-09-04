import { Controller, Get, Param, HttpException, HttpStatus } from "@nestjs/common";
import type { PublicStoreDTO, ProductDTO, CategoryDTO } from "@sam-store/contracts";
import { PrismaStoreRepository, PrismaCatalogRepository } from "../persistence/prisma-repositories.js";

// Public-facing storefront endpoints (no auth — the public link is the access control).

@Controller("public")
export class PublicStoreController {
  private readonly stores = new PrismaStoreRepository();
  private readonly catalog = new PrismaCatalogRepository();

  /** GET /public/stores/:slug — public store profile + active products */
  @Get("stores/:slug")
  async getStore(@Param("slug") slug: string) {
    const store = await this.stores.findBySlug(slug);
    if (!store) {
      throw new HttpException({ type: "not_found", message: "Store not found" }, HttpStatus.NOT_FOUND);
    }
    if (!store.guestOrderingEnabled || store.orderingPaused) {
      return {
        id: store.id,
        slug: store.slug,
        name: store.name,
        description: store.description,
        currencyCode: store.currencyCode,
        timezone: store.timezone,
        guestOrderingEnabled: store.guestOrderingEnabled,
        orderingPaused: store.orderingPaused,
        closedStoreMessage: store.closedStoreMessage,
        deliveryFeeMinor: store.deliveryFeeMinor,
        deliveryEnabled: store.deliveryEnabled,
        pickupEnabled: store.pickupEnabled,
        minOrderAmountMinor: store.minOrderAmountMinor,
      };
    }
    const products = await this.catalog.listActiveProducts(store.id);
    return {
      store: {
        id: store.id,
        slug: store.slug,
        name: store.name,
        description: store.description,
        currencyCode: store.currencyCode,
        timezone: store.timezone,
        guestOrderingEnabled: store.guestOrderingEnabled,
        orderingPaused: store.orderingPaused,
        closedStoreMessage: store.closedStoreMessage,
        deliveryFeeMinor: store.deliveryFeeMinor,
        deliveryEnabled: store.deliveryEnabled,
        pickupEnabled: store.pickupEnabled,
        minOrderAmountMinor: store.minOrderAmountMinor,
        accentColor: store.accentColor,
        bannerText: store.bannerText,
        logoUrl: store.logoUrl,
      },
      products: products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        priceMinor: p.priceMinor,
        category: p.categoryName ? { id: "", name: p.categoryName, slug: "", sortOrder: 0 } : null,
        images: p.images.map((url, i) => ({ url, sortOrder: i })),
        availableQuantity: p.quantityOnHand - p.quantityReserved,
      })),
    };
  }
}