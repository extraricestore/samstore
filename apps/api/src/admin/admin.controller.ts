import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { AUTH_SERVICE, AuthService } from "../auth/auth.service.js";
import { ProductAdminService } from "./product-admin.service.js";
import { OrderAdminService } from "./order-admin.service.js";
import type { OrderState } from "../domain/order-state.js";

const ADMIN_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER", "STAFF"];

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

function requireAdmin(user: AuthPrincipal | undefined): asserts user is AuthPrincipal {
  if (!user) throw new HttpException({ type: "unauthorized", message: "Not authenticated" }, HttpStatus.UNAUTHORIZED);
  if (!ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
}

/** Resolve the tenant store: from the token, or explicit for platform admins.
 *  Demo fallback: single-store deployments without a membership map to "sam-store"
 *  (remove when multi-store onboarding lands). */
function resolveStoreId(user: AuthPrincipal, explicit?: string): string {
  if (user.storeId) return user.storeId;
  if (user.role === "PLATFORM_ADMIN" && explicit) return explicit;
  if (user.role === "STORE_OWNER") return "cmtifdks2000094ic1j9w8th7"; // demo store (sam-store)
  throw new HttpException({ type: "forbidden", message: "No store access" }, HttpStatus.FORBIDDEN);
}

// Admin endpoints — JWT-protected, tenant-scoped via token storeId.

@Controller("admin")
@UseGuards(JwtAuthGuard)
export class AdminController {
  private readonly productsAdmin = new ProductAdminService();
  private readonly ordersAdmin = new OrderAdminService();

  constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthService) {}

  /** GET /admin/me — current user summary */
  @Get("me")
  async me(@Req() req: Request & { user?: AuthPrincipal }) {
    const user = req.user;
    if (!user) throw new HttpException({ type: "unauthorized", message: "Not authenticated" }, HttpStatus.UNAUTHORIZED);
    return { id: user.sub, email: user.email, role: user.role, storeId: user.storeId ?? null };
  }

  /** GET /admin/orders — list recent orders (tenant-scoped). */
  @Get("orders")
  async orders(@Req() req: Request & { user?: AuthPrincipal }) {
    const user = req.user;
    requireAdmin(user);
    const storeId = resolveStoreId(user);
    const list = await prisma.order.findMany({
      where: { storeId },
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
    return { orders: list };
  }

  /** GET /admin/orders/:id — full detail (items + history). */
  @Get("orders/:id")
  async orderDetail(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = resolveStoreId(user);
    const detail = await this.ordersAdmin.detail(storeId, id);
    if (!detail) throw new HttpException({ type: "not_found", message: "Order not found" }, HttpStatus.NOT_FOUND);
    return detail;
  }

  /** PATCH /admin/orders/:id/status — transition with reason for manual overrides. */
  @Patch("orders/:id/status")
  async transitionOrder(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: { toStatus: OrderState; reason?: string },
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = resolveStoreId(user);
    const result = await this.ordersAdmin.transition(storeId, id, body.toStatus, body.reason, {
      type: user.role,
      id: user.sub,
    });
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** GET /admin/products — tenant-scoped product list with stock. */
  @Get("products")
  async listProducts(@Req() req: Request & { user?: AuthPrincipal }) {
    const user = req.user;
    requireAdmin(user);
    const storeId = resolveStoreId(user);
    return { products: await this.productsAdmin.list(storeId) };
  }

  /** GET /admin/products/categories — store categories. */
  @Get("products/categories")
  async listCategories(@Req() req: Request & { user?: AuthPrincipal }) {
    const user = req.user;
    requireAdmin(user);
    const storeId = resolveStoreId(user);
    return { categories: await this.productsAdmin.listCategories(storeId) };
  }

  /** POST /admin/products — create product. */
  @Post("products")
  async createProduct(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: { name: string; sku: string; priceMinor: number; stock?: number; categorySlug?: string; description?: string },
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = resolveStoreId(user);
    const result = await this.productsAdmin.create(storeId, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** PATCH /admin/products/:id — update product + stock. */
  @Patch("products/:id")
  async updateProduct(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: Partial<{ name: string; sku: string; priceMinor: number; stock?: number; categorySlug?: string; description?: string; isActive?: boolean }>,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = resolveStoreId(user);
    const result = await this.productsAdmin.update(storeId, id, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** DELETE /admin/products/:id — soft delete. */
  @Delete("products/:id")
  async removeProduct(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = resolveStoreId(user);
    const result = await this.productsAdmin.remove(storeId, id);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }
}