import { Module } from "@nestjs/common";
import { CHECKOUT_SERVICE, CheckoutService } from "./checkout/checkout.service.js";
import { CheckoutController } from "./checkout/checkout.controller.js";
import { PublicStoreController } from "./public/public-store.controller.js";
import { CartController } from "./cart/cart.controller.js";
import { CartService, CART_SERVICE } from "./cart/cart.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService, AUTH_SERVICE } from "./auth/auth.service.js";
import { PrismaAuthRepository } from "./auth/auth.repository.js";
import {
  PrismaStoreRepository,
  PrismaCatalogRepository,
  PrismaCartRepository,
  PrismaOrderRepository,
  PrismaOrderSequenceRepository,
} from "./persistence/prisma-repositories.js";

const CLAIM_SECRET = process.env.CLAIM_SIGNING_SECRET ?? "dev-only-in-memory-secret-0123456789";

@Module({
  controllers: [CheckoutController, PublicStoreController, CartController, AuthController],
  providers: [
    {
      provide: AUTH_SERVICE,
      useFactory: () =>
        new AuthService(
          new PrismaAuthRepository(),
          {
            jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me-0123456789",
            jwtExpiresIn: "7d",
          },
        ),
    },
    {
      provide: "AUTH_CONFIG",
      useValue: { jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me-0123456789" },
    },
    {
      provide: CART_SERVICE,
      useFactory: () => new CartService(new PrismaCartRepository(), new PrismaCatalogRepository()),
    },
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