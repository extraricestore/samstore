import {
  Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Post, Req, UseGuards,
} from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { CREDIT_SERVICE, CreditService } from "./credit.service.js";

const MANAGE_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER"];
const ADMIN_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER", "STAFF", "SALES_AGENT"];

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
export class CreditController {
  constructor(@Inject(CREDIT_SERVICE) private readonly creditSvc: CreditService) {}

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

  /** PATCH /admin/credit/:storeCustomerId/approve — approve customer for utang with a limit. */
  @Patch("credit/:storeCustomerId/approve")
  async approveCredit(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("storeCustomerId") storeCustomerId: string,
    @Body() body: { limitMinor: number },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    if (!user || !MANAGE_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Owner/manager only" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    const result = await this.creditSvc.approveCredit(storeId, storeCustomerId, body.limitMinor, user.sub);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** GET /admin/credit/utang — customers with outstanding balances. */
  @Get("credit/utang")
  async utangList(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    return { customers: await this.creditSvc.utangList(storeId) };
  }

  /** GET /admin/credit/:storeCustomerId — ledger for one customer. */
  @Get("credit/:storeCustomerId")
  async customerCredit(@Req() req: Request & { user?: AuthPrincipal }, @Param("storeCustomerId") storeCustomerId: string, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    const data = await this.creditSvc.customerCredit(storeId, storeCustomerId);
    if (!data) throw new HttpException({ type: "not_found", message: "Customer not found" }, HttpStatus.NOT_FOUND);
    return data;
  }

  /** POST /admin/credit/:storeCustomerId/pay — record a cash payment against utang. */
  @Post("credit/:storeCustomerId/pay")
  async recordPayment(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("storeCustomerId") storeCustomerId: string,
    @Body() body: { amountMinor: number; note?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    const result = await this.creditSvc.recordPayment(storeId, storeCustomerId, body.amountMinor, body.note, user.sub);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }
}