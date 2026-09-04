import { Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { ApiError, PosSellRequest, PosHoldRequest, PosHoldItemsRequest, PosHoldCompleteRequest } from "@sam-store/contracts";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { POS_SERVICE, PosService } from "./pos.service.js";

const ADMIN_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER", "STAFF"];

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

// POS endpoints — admin-guarded, tenant-scoped via membership + X-Store-Id.

@Controller("admin/pos")
@UseGuards(JwtAuthGuard)
export class PosController {
  constructor(@Inject(POS_SERVICE) private readonly pos: PosService) {}

  private async guardAndStore(req: Request & { user?: AuthPrincipal }, headerStoreId?: string): Promise<string> {
    const user = req.user;
    if (!user) throw new HttpException({ type: "unauthorized", message: "Not authenticated" }, HttpStatus.UNAUTHORIZED);
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    }
    if (user.role === "PLATFORM_ADMIN") {
      return headerStoreId || (await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } }))?.storeId || "cmtifdks2000094ic1j9w8th7";
    }
    if (headerStoreId) {
      const m = await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: headerStoreId } } });
      if (!m || m.status !== "ACTIVE") throw new HttpException({ type: "forbidden", message: "Not a member of that store" }, HttpStatus.FORBIDDEN);
      return headerStoreId;
    }
    const m = user.storeId
      ? await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: user.storeId } } })
      : null;
    return m?.status === "ACTIVE" ? m.storeId
      : (await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } }))?.storeId
      ?? "cmtifdks2000094ic1j9w8th7";
  }

  /** POST /admin/pos/sell — immediate cash/utang sale (V1: tendered + change, credit dates). */
  @Post("sell")
  async sell(@Req() req: Request & { user?: AuthPrincipal }, @Body() body: PosSellRequest, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user!;
    const storeId = await this.guardAndStore(req, headerStoreId);
    const result = await this.pos.sell(storeId, user.sub, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return { ...result.value, storeId };
  }

  /** POST /admin/pos/hold — create a held order (stock decremented, status ON_HOLD). */
  @Post("hold")
  async hold(@Req() req: Request & { user?: AuthPrincipal }, @Body() body: PosHoldRequest, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user!;
    const storeId = await this.guardAndStore(req, headerStoreId);
    const result = await this.pos.hold(storeId, user.sub, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return { ...result.value, storeId };
  }

  /** GET /admin/pos/holds — current ON_HOLD orders. */
  @Get("holds")
  async holds(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user!;
    const storeId = await this.guardAndStore(req, headerStoreId);
    return { holds: await this.pos.listHolds(storeId), storeId };
  }

  /** PATCH /admin/pos/holds/:id/items — replace a held order's lines (stock delta, totals recomputed). */
  @Patch("holds/:id/items")
  async holdItems(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string, @Body() body: PosHoldItemsRequest, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user!;
    const storeId = await this.guardAndStore(req, headerStoreId);
    const result = await this.pos.replaceItems(storeId, user.sub, id, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return { ...result.value, storeId };
  }

  /** POST /admin/pos/holds/:id/complete — complete a held order (cash w/ tendered or utang w/ dates). */
  @Post("holds/:id/complete")
  async holdComplete(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string, @Body() body: PosHoldCompleteRequest, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user!;
    const storeId = await this.guardAndStore(req, headerStoreId);
    const result = await this.pos.completeHold(storeId, user.sub, id, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return { ...result.value, storeId };
  }

  /** POST /admin/pos/holds/:id/void — void a held order (stock restored). */
  @Post("holds/:id/void")
  async holdVoid(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string, @Body() body: { reason?: string }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user!;
    const storeId = await this.guardAndStore(req, headerStoreId);
    const result = await this.pos.voidHold(storeId, user.sub, id, body?.reason);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return { ...result.value, storeId };
  }

  /** POST /admin/pos/quick-customer — create/reuse a store customer (no login account), for POS autosave. */
  @Post("quick-customer")
  async quickCustomer(@Req() req: Request & { user?: AuthPrincipal }, @Body() body: { name: string; phone?: string }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user!;
    const storeId = await this.guardAndStore(req, headerStoreId);
    if (!body?.name?.trim()) throw new HttpException({ type: "validation", errors: ["name is required"] }, HttpStatus.UNPROCESSABLE_ENTITY);
    const id = await this.pos.quickCustomer(storeId, body.name, body.phone);
    if (!id) throw new HttpException({ type: "validation", errors: ["name is required"] }, HttpStatus.UNPROCESSABLE_ENTITY);
    return { id, storeId };
  }
}