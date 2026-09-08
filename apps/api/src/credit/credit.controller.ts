import {
  Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Post, Query, Req, UseGuards,
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an ISO date query param; date-only `to` bounds are inclusive through the whole UTC day. */
function parseDateBound(value: string | undefined, name: string, endOfDay = false): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new HttpException({ type: "validation", errors: [`${name} must be a valid ISO date`] }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  if (endOfDay && DATE_ONLY.test(value)) d.setTime(d.getTime() + 86_399_999);
  return d;
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

  /** GET /admin/credit/utang?status=unpaid|paid&search=&from=&to= — customers with credit history. */
  @Get("credit/utang")
  async utangList(
    @Req() req: Request & { user?: AuthPrincipal },
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    const s = status === "paid" ? "paid" : "unpaid";
    const filters = {
      search,
      from: parseDateBound(from, "from"),
      to: parseDateBound(to, "to", true),
    };
    return { customers: await this.creditSvc.utangList(storeId, s, filters), storeId };
  }

  /** GET /admin/credit/:storeCustomerId?from=&to= — ledger for one customer. */
  @Get("credit/:storeCustomerId")
  async customerCredit(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("storeCustomerId") storeCustomerId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    const data = await this.creditSvc.customerCredit(storeId, storeCustomerId, {
      from: parseDateBound(from, "from"),
      to: parseDateBound(to, "to", true),
    });
    if (!data) throw new HttpException({ type: "not_found", message: "Customer not found" }, HttpStatus.NOT_FOUND);
    return data;
  }

  /** POST /admin/credit/:storeCustomerId/pay — record a cash payment against utang. */
  @Post("credit/:storeCustomerId/pay")
  async recordPayment(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("storeCustomerId") storeCustomerId: string,
    @Body() body: { amountMinor: number; note?: string; signatureData?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    const result = await this.creditSvc.recordPayment(storeId, storeCustomerId, body.amountMinor, body.note, user.sub, body.signatureData);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }
}