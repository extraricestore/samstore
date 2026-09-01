import { Module } from "@nestjs/common";
import {
  InMemoryStoreRepository,
  InMemoryCatalogRepository,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  InMemoryOrderSequenceRepository,
} from "./persistence/repositories.js";
import { CheckoutService, CHECKOUT_SERVICE } from "./checkout/checkout.service.js";
import { CheckoutController } from "./checkout/checkout.controller.js";

const CLAIM_SECRET = process.env.CLAIM_SIGNING_SECRET ?? "dev-only-in-memory-secret-0123456789";

@Module({
  controllers: [CheckoutController],
  providers: [
    {
      // CheckoutService is framework-free by design (tests construct it directly).
      // This factory wires the in-memory repositories until DATABASE_URL is live.
      provide: CHECKOUT_SERVICE,
      useFactory: () => {
        const stores = new InMemoryStoreRepository();
        const catalog = new InMemoryCatalogRepository();
        const carts = new InMemoryCartRepository();
        const orders = new InMemoryOrderRepository();
        const sequences = new InMemoryOrderSequenceRepository();

        // DEV-ONLY demo seed for local smoke tests. Enabled with SEED_DEMO=true.
        // Replaced entirely by Prisma-backed repositories + real migrations once DATABASE_URL is live.
        if (process.env.SEED_DEMO === "true") {
          stores.seed({
            id: "store-demo",
            slug: "sam-store",
            name: "Sam's Store",
            currencyCode: "PHP",
            timezone: "Asia/Manila",
            status: "ACTIVE",
            guestOrderingEnabled: true,
            orderingPaused: false,
            closedStoreMessage: null,
            deliveryFeeMinor: 5000,
            deliveryEnabled: true,
            pickupEnabled: false,
            minOrderAmountMinor: 0,
          });
          catalog.seed({
            id: "prod-demo",
            storeId: "store-demo",
            sku: "SKU-001",
            name: "Kape Barako",
            description: "Strong Filipino coffee",
            priceMinor: 12000,
            isActive: true,
            categoryName: "Drinks",
            images: ["https://placehold.test/kape.png"],
            quantityOnHand: 50,
            quantityReserved: 0,
          });
          carts.seed({
            id: "cart-demo",
            storeId: "store-demo",
            token: "cart-demo-token",
            status: "OPEN",
            lines: [{ productId: "prod-demo", quantity: 2, unitPriceMinor: 12000 }],
          });
        }

        return new CheckoutService(stores, catalog, carts, orders, sequences, CLAIM_SECRET);
      },
    },
  ],
  exports: [CHECKOUT_SERVICE],
})
export class AppModule {}