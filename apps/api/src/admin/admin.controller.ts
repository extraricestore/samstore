import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { AUTH_SERVICE, AuthService } from "../auth/auth.service.js";

const ADMIN_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN"];

function statusFor(error: ApiError): HttpStatus {
  switch (error.type) {
    case "unauthorized":
      return HttpStatus.UNAUTHORIZED;
    case "forbidden":
      return HttpStatus.FORBIDDEN;
    case "validation":
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case "not_found":
      return HttpStatus.NOT_FOUND;
    case "conflict":
      return HttpStatus.CONFLICT;
    case "rate_limited":
      return HttpStatus.TOO_MANY_REQUESTS;
  }
}

// Admin endpoints — protected by JWT; role-scoped to store owner / platform admin.

@Controller("admin")
export class AdminController {
  constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthService) {}

  /** POST /admin/register — register a store-owner account (dev/demo convenience). */
  @Post("register")
  @UseGuards(JwtAuthGuard)
  async register(
    @Body() body: { email: string; password: string; name?: string; storeId: string },
    @Req() req: Request & { user?: AuthPrincipal },
  ) {
    // Only a platform admin (or first-run bootstrap) can create store owners.
    // For the demo we allow any authenticated admin to register a store owner.
    if (!body.storeId) {
      throw new HttpException({ type: "validation", message: "storeId is required" }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const result = await this.auth.register({
      email: body.email,
      password: body.password,
      name: body.name,
      storeId: body.storeId,
      role: "STORE_OWNER",
    });
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** GET /admin/orders — list recent orders (role-scoped). */
  @Get("orders")
  @UseGuards(JwtAuthGuard)
  async orders(@Req() req: Request & { user?: AuthPrincipal }) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) {
      throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    }
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalMinor: true,
        currencyCode: true,
        customerName: true,
        customerPhone: true,
        createdAt: true,
      },
    });
    return { orders };
  }
}