import { Module } from "@nestjs/common";
import { CHECKOUT_SERVICE, CheckoutService } from "./checkout/checkout.service.js";
import { CheckoutController } from "./checkout/checkout.controller.js";
import {
  PrismaStoreRepository,
  PrismaCatalogRepository,
  PrismaCartRepository,
  PrismaOrderRepository,
  PrismaOrderSequenceRepository,
} from "./persistence/prisma-repositories.js";

const CLAIM_SECRET = process.env.CLAIM_SIGNING_SECRET ?? "dev-only-in-memory-secret-0123456789";

@Module({
  controllers: [CheckoutController],
  providers: [
    {
      // CheckoutService is framework-free by design (tests construct it directly).
      // Prisma-backed repositories hit the real Postgres (Supabase).
      provide: CHECKOUT_SERVICE,
      useFactory: () =>
        new CheckoutService(
          new PrismaStoreRepository(),
          new PrismaCatalogRepository(),
          new PrismaCartRepository(),
          new PrismaOrderRepository(),
          new PrismaOrderSequenceRepository(),
          CLAIM_SECRET,
        ),
    },
  ],
  exports: [CHECKOUT_SERVICE],
})
export class AppModule {}