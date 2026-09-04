import { Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Req, UseGuards } from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { DELIVERY_SERVICE, DeliveryService } from "./delivery.service.js";

function statusFor(error: ApiError): HttpStatus {
  switch (error.type) {
    case "validation": return HttpStatus.UNPROCESSABLE_ENTITY;
    case "not_found": return HttpStatus.NOT_FOUND;
    case "conflict": return HttpStatus.CONFLICT;
    case "forbidden": return HttpStatus.FORBIDDEN;
    case "unauthorized": return HttpStatus.UNAUTHORIZED;
    case "rate_limited": return HttpStatus.TOO_MANY_REQUESTS;
  }
}

// Delivery endpoints — DELIVERY role only, tenant-scoped to the courier's store.

@Controller("delivery")
@UseGuards(JwtAuthGuard)
export class DeliveryController {
  constructor(@Inject(DELIVERY_SERVICE) private readonly deliverySvc: DeliveryService) {}

  private async resolveStore(user: AuthPrincipal, header?: string): Promise<string> {
    if (header) {
      const m = await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: header } } });
      if (m?.status === "ACTIVE") return header;
      throw new HttpException({ type: "forbidden", message: "Not a member of that store" }, HttpStatus.FORBIDDEN);
    }
    if (user.storeId) {
      const m = await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: user.storeId } } });
      if (m?.status === "ACTIVE") return user.storeId;
    }
    const first = await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } });
    if (first) return first.storeId;
    throw new HttpException({ type: "forbidden", message: "No store membership" }, HttpStatus.FORBIDDEN);
  }

  private requireDelivery(user: AuthPrincipal | undefined): asserts user is AuthPrincipal {
    if (!user || (user.role !== "DELIVERY" && user.role !== "PLATFORM_ADMIN")) {
      throw new HttpException({ type: "forbidden", message: "Delivery role required" }, HttpStatus.FORBIDDEN);
    }
  }

  /** GET /delivery/orders — all OUT_FOR_DELIVERY orders for the courier's store. */
  @Get("orders")
  async myDeliveries(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    this.requireDelivery(user);
    const storeId = await this.resolveStore(user, headerStoreId);
    return { deliveries: await this.deliverySvc.myDeliveries(storeId), storeId };
  }

  /** PATCH /delivery/orders/:id/status — DELIVERED | FAILED_DELIVERY (+ reason). */
  @Patch("orders/:id/status")
  async markStatus(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: { toStatus: "DELIVERED" | "FAILED_DELIVERY"; reason?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    this.requireDelivery(user);
    if (!["DELIVERED", "FAILED_DELIVERY"].includes(body?.toStatus ?? "")) {
      throw new HttpException({ type: "validation", errors: ["toStatus must be DELIVERED or FAILED_DELIVERY"] }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const storeId = await this.resolveStore(user, headerStoreId);
    const result = await this.deliverySvc.markStatus(storeId, id, body.toStatus, body.reason);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }
}