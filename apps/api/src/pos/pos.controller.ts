import { Body, Controller, Headers, HttpException, HttpStatus, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { ApiError, PosSellRequest } from "@sam-store/contracts";
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

  @Post("sell")
  async sell(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: PosSellRequest,
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    if (!user) throw new HttpException({ type: "unauthorized", message: "Not authenticated" }, HttpStatus.UNAUTHORIZED);
    if (!ADMIN_ROLES.includes(user.role)) {
      throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    }

    // Tenant resolution (same rules as admin controller)
    let storeId: string;
    if (user.role === "PLATFORM_ADMIN") {
      storeId = headerStoreId || (await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } }))?.storeId || "cmtifdks2000094ic1j9w8th7";
    } else if (headerStoreId) {
      const m = await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: headerStoreId } } });
      if (!m || m.status !== "ACTIVE") throw new HttpException({ type: "forbidden", message: "Not a member of that store" }, HttpStatus.FORBIDDEN);
      storeId = headerStoreId;
    } else {
      const m = user.storeId
        ? await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: user.storeId } } })
        : null;
      storeId = m?.status === "ACTIVE" ? m.storeId
        : (await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } }))?.storeId
        ?? "cmtifdks2000094ic1j9w8th7";
    }

    const result = await this.pos.sell(storeId, user.sub, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return { ...result.value, storeId };
  }
}