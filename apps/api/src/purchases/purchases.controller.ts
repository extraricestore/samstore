import {
  Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Post, Req, UseGuards,
} from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { PURCHASES_SERVICE, PurchasesService } from "./purchases.service.js";

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

@Controller("admin")
@UseGuards(JwtAuthGuard)
export class PurchasesController {
  constructor(@Inject(PURCHASES_SERVICE) private readonly purchasesSvc: PurchasesService) {}

  private async resolveStore(user: AuthPrincipal, header?: string): Promise<string> {
    if (user.role === "PLATFORM_ADMIN") {
      return header || (await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } }))?.storeId || "cmtifdks2000094ic1j9w8th7";
    }
    if (header) {
      const m = await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: header } } });
      if (m?.status === "ACTIVE") return header;
      throw new HttpException({ type: "forbidden", message: "Not a member of that store" }, HttpStatus.FORBIDDEN);
    }
    if (user.storeId) {
      const m = await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: user.storeId } } });
      if (m?.status === "ACTIVE") return user.storeId;
    }
    return (await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } }))?.storeId ?? "cmtifdks2000094ic1j9w8th7";
  }

  @Post("purchases")
  async create(@Req() req: Request & { user?: AuthPrincipal }, @Body() body: { vendor?: string; note?: string; items: { productId: string; quantity: number; costMinor: number }[] }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    const result = await this.purchasesSvc.create(storeId, user.sub, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  @Get("purchases")
  async list(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    return { purchases: await this.purchasesSvc.list(storeId) };
  }

  @Get("purchases/replenishment")
  async replenishment(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    return { items: await this.purchasesSvc.replenishmentList(storeId) };
  }
}