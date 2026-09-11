import {
  Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Post, Req, UseGuards,
} from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { requireUser, resolveTenant, TENANT_ROLES } from "../auth/tenant-context.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { cacheBust, cacheKey } from "../persistence/ttl-cache.js";
import { PAYMENTS_SERVICE, PaymentsService } from "./payments.service.js";

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

// Payments endpoints — admin-guarded, tenant-scoped.

@Controller("admin")
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(@Inject(PAYMENTS_SERVICE) private readonly paymentsSvc: PaymentsService) {}

  /** POST /admin/orders/:id/payments — record a payment on an order. */
  @Post("orders/:id/payments")
  async recordPayment(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: { method: "cash" | "credit" | "cod_collected"; amountMinor: number; changeMinor?: number; note?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireUser(user);
    const { storeId } = await resolveTenant(user, headerStoreId, TENANT_ROLES.ADMIN);
    const result = await this.paymentsSvc.recordPayment({ orderId: id, storeId, method: body.method, amountMinor: body.amountMinor, changeMinor: body.changeMinor, note: body.note, createdBy: user.sub });
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** GET /admin/orders/:id/receipt — printable receipt view. */
  @Get("orders/:id/receipt")
  async receipt(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireUser(user);
    const { storeId } = await resolveTenant(user, headerStoreId, TENANT_ROLES.ADMIN);
    const receipt = await this.paymentsSvc.receipt(id, storeId);
    if (!receipt) throw new HttpException({ type: "not_found", message: "Order not found" }, HttpStatus.NOT_FOUND);
    return receipt;
  }

  /** GET /admin/orders/:id/payments — payment history. */
  @Get("orders/:id/payments")
  async payments(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireUser(user);
    const { storeId } = await resolveTenant(user, headerStoreId, TENANT_ROLES.ADMIN);
    const rows = await this.paymentsSvc.paymentsFor(id, storeId);
    if (!rows) throw new HttpException({ type: "not_found", message: "Order not found" }, HttpStatus.NOT_FOUND);
    return { payments: rows };
  }

  /** PATCH /admin/orders/:id/void — void an unfulfilled POS sale. */
  @Patch("orders/:id/void")
  async voidOrder(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireUser(user);
    const { storeId } = await resolveTenant(user, headerStoreId, TENANT_ROLES.OWNER_MANAGER);
    cacheBust(cacheKey("orders", storeId));
    const result = await this.paymentsSvc.voidOrder(id, storeId, user.sub, body.reason);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** PATCH /admin/orders/:id/refund — refund a collected sale. */
  @Patch("orders/:id/refund")
  async refundOrder(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: { amountMinor?: number; reason?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireUser(user);
    const { storeId } = await resolveTenant(user, headerStoreId, TENANT_ROLES.OWNER_MANAGER);
    cacheBust(cacheKey("orders", storeId));
    const result = await this.paymentsSvc.refundOrder(id, storeId, user.sub, body.amountMinor, body.reason);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }
}