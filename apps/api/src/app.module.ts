import { Module } from "@nestjs/common";
import { CHECKOUT_SERVICE, CheckoutService } from "./checkout/checkout.service.js";
import { CheckoutController } from "./checkout/checkout.controller.js";
import { PublicStoreController } from "./public/public-store.controller.js";
import { CartController } from "./cart/cart.controller.js";
import { CartService, CART_SERVICE } from "./cart/cart.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService, AUTH_SERVICE } from "./auth/auth.service.js";
import { PrismaAuthRepository } from "./auth/auth.repository.js";
import { AdminController } from "./admin/admin.controller.js";
import { JwtAuthGuard } from "./auth/auth.guard.js";
import type { AuthConfig } from "./auth/auth.domain.js";
import { MessengerService, SuppressedMessengerProvider } from "./messenger/messenger.adapter.js";
import { OrderLookupService, ORDER_LOOKUP_SERVICE } from "./orders/order-lookup.service.js";
import { OrderLookupController } from "./orders/order-lookup.controller.js";
import { VoucherPublicService } from "./voucher/voucher-public.service.js";
import { CustomerAuthService, CUSTOMER_AUTH_SERVICE } from "./auth/customer-auth.service.js";
import { CustomerAuthController } from "./auth/customer-auth.controller.js";
import { LoyaltyService, LOYALTY_SERVICE } from "./loyalty/loyalty.service.js";
import { NotificationsService, NOTIFICATIONS_SERVICE } from "./notifications/notifications.service.js";
import { PosService, POS_SERVICE } from "./pos/pos.service.js";
import { PosController } from "./pos/pos.controller.js";
import { verifyToken } from "./auth/auth.domain.js";
import {
  PrismaStoreRepository,
  PrismaCatalogRepository,
  PrismaCartRepository,
  PrismaOrderRepository,
  PrismaOrderSequenceRepository,
} from "./persistence/prisma-repositories.js";

const CLAIM_SECRET = process.env.CLAIM_SIGNING_SECRET ?? "dev-only-in-memory-secret-0123456789";

@Module({
  controllers: [CheckoutController, PublicStoreController, CartController, AuthController, AdminController, OrderLookupController, CustomerAuthController, PosController],
  providers: [
    {
      provide: POS_SERVICE,
      useFactory: () => new PosService(),
    },
    {
      provide: CUSTOMER_AUTH_SERVICE,
      useFactory: () =>
        new CustomerAuthService({
          jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me-0123456789",
          jwtExpiresIn: "30d",
        }),
    },
    {
      provide: LOYALTY_SERVICE,
      useFactory: () => new LoyaltyService(),
    },
    {
      provide: NOTIFICATIONS_SERVICE,
      inject: ["MESSENGER_SERVICE"],
      useFactory: (messenger: MessengerService) => new NotificationsService(messenger),
    },
    {
      provide: ORDER_LOOKUP_SERVICE,
      useFactory: () => new OrderLookupService(CLAIM_SECRET),
    },
    {
      provide: AUTH_SERVICE,
      useFactory: () =>
        new AuthService(
          new PrismaAuthRepository(),
          {
            jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me-0123456789",
            jwtExpiresIn: "7d",
          } as AuthConfig,
        ),
    },
    {
      provide: "AUTH_CONFIG",
      useValue: { jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me-0123456789" },
    },
    JwtAuthGuard,
    {
      provide: CART_SERVICE,
      useFactory: () => new CartService(new PrismaCartRepository(), new PrismaCatalogRepository()),
    },
    {
      provide: "MESSENGER_SERVICE",
      // No store is connected yet → all sends suppressed (spec-mandated default).
      useFactory: () => new MessengerService(new SuppressedMessengerProvider(), () => false),
    },
    {
      provide: "VOUCHER_PUBLIC_SERVICE",
      useFactory: () => new VoucherPublicService(),
    },
    {
      // CheckoutService is framework-free by design (tests construct it directly).
      // Prisma-backed repositories hit the real Postgres (Supabase).
      provide: CHECKOUT_SERVICE,
      inject: ["MESSENGER_SERVICE", "VOUCHER_PUBLIC_SERVICE", LOYALTY_SERVICE],
      useFactory: (messenger: MessengerService, voucher: VoucherPublicService, loyalty: LoyaltyService) =>
        new CheckoutService(
          new PrismaStoreRepository(),
          new PrismaCatalogRepository(),
          new PrismaCartRepository(),
          new PrismaOrderRepository(),
          new PrismaOrderSequenceRepository(),
          CLAIM_SECRET,
          async (order) => {
            // Post-order Messenger notification (suppressed until a store is connected).
            await messenger.notifyCustomer({
              psid: `order_${order.orderNumber}`,
              text: `Order ${order.orderNumber} received (${order.totalMinor / 100} ${order.currencyCode}).`,
              storeId: order.storeId,
            });
          },
          voucher, // VoucherGateway — validate + redeem at checkout
          loyalty, // LoyaltyGateway — ensure profile, redeem, record
          async (customerToken: string) => {
            // Resolve a customer JWT to a customer id (role must be CUSTOMER).
            try {
              const decoded = verifyToken(customerToken, {
                jwtSecret: process.env.JWT_SECRET ?? "dev-jwt-secret-change-me-0123456789",
                jwtExpiresIn: "30d",
              });
              return decoded.role === "CUSTOMER" ? decoded.sub : null;
            } catch {
              return null;
            }
          },
        ),
    },
  ],
  exports: [CHECKOUT_SERVICE, "MESSENGER_SERVICE"],
})
export class AppModule {}