import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { StoreSettingsService } from "./store-settings.service.js";
import { VoucherAdminService } from "./voucher-admin.service.js";
import { StoreAdminService } from "./store-admin.service.js";
import { AnalyticsService } from "./analytics.service.js";
import { TeamService } from "./team.service.js";
import { WarehouseService } from "./warehouse.service.js";
import { LoyaltyService } from "../loyalty/loyalty.service.js";
import { NOTIFICATIONS_SERVICE, type NotificationsService } from "../notifications/notifications.service.js";
import type { OrderState } from "../domain/order-state.js";

const ADMIN_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER", "STAFF"];
/** Roles that can also view orders (sales agents work the order/inbox surface). */
const VIEW_ROLES = [...ADMIN_ROLES, "SALES_AGENT"] as const;
/** Roles that can manage the store itself (team invites, store settings). */
const MANAGE_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN"] as const;
const DEMO_STORE_ID = "cmtifdks2000094ic1j9w8th7"; // seeded sam-store (fallback for legacy demo users)

function statusFor(error: ApiError): HttpStatus {
  switch (error.type) {
    case "unauthorized": return HttpStatus.UNAUTHORIZED;
    case "forbidden": return HttpStatus.FORBIDDEN;
    case "validation": return HttpStatus.UNPROCESSABLE_ENTITY;
    case "not_found": return HttpStatus.NOT_FOUND;
    case "conflict": return HttpStatus.CONFLICT;
    case "rate_limited": return HttpStatus.TOO_MANY_REQUESTS;
  }
}

function requireAdmin(user: AuthPrincipal | undefined): asserts user is AuthPrincipal {
  if (!user) throw new HttpException({ type: "unauthorized", message: "Not authenticated" }, HttpStatus.UNAUTHORIZED);
  if (!ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
}

/** Allow VIEW_ROLES (orders/sales surface) — sales agents included. */
function requireView(user: AuthPrincipal | undefined): asserts user is AuthPrincipal {
  if (!user) throw new HttpException({ type: "unauthorized", message: "Not authenticated" }, HttpStatus.UNAUTHORIZED);
  if (!(VIEW_ROLES as readonly string[]).includes(user.role)) {
    throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
  }
}

/** Store-management surface only (team invites, settings, products, etc.). */
function requireManage(user: AuthPrincipal | undefined): asserts user is AuthPrincipal {
  requireAdmin(user);
  if (!(MANAGE_ROLES as readonly string[]).includes(user.role)) {
    throw new HttpException({ type: "forbidden", message: "Owner or platform admin only" }, HttpStatus.FORBIDDEN);
  }
}

// Admin endpoints — JWT-protected, tenant-scoped via membership + X-Store-Id.

@Controller("admin")
@UseGuards(JwtAuthGuard)
export class AdminController {
  private readonly productsAdmin = new ProductAdminService();
  private readonly ordersAdmin: OrderAdminService;
  private readonly settingsAdmin = new StoreSettingsService();
  private readonly vouchersAdmin = new VoucherAdminService();
  private readonly storesAdmin = new StoreAdminService();
  private readonly analytics = new AnalyticsService();
  private readonly team = new TeamService();
  private readonly warehouses = new WarehouseService();
  private readonly loyalty = new LoyaltyService();

  constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    @Inject(NOTIFICATIONS_SERVICE) notifications: NotificationsService,
  ) {
    this.ordersAdmin = new OrderAdminService(notifications);
  }

  /**
   * Resolve the tenant store for a request:
   * 1. X-Store-Id header — must be an ACTIVE membership (or platform admin).
   * 2. Token storeId claim — must be an ACTIVE membership.
   * 3. First ACTIVE membership.
   * 4. Demo fallback for legacy users with no membership → sam-store.
   */
  private async resolveStoreId(user: AuthPrincipal, headerStoreId?: string): Promise<string> {
    if (user.role === "PLATFORM_ADMIN") {
      if (headerStoreId) return headerStoreId;
      const first = await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } });
      return first?.storeId ?? DEMO_STORE_ID;
    }
    if (headerStoreId) {
      const m = await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: headerStoreId } } });
      if (m && m.status === "ACTIVE") return headerStoreId;
      throw new HttpException({ type: "forbidden", message: "Not a member of that store" }, HttpStatus.FORBIDDEN);
    }
    if (user.storeId) {
      const m = await prisma.userStore.findUnique({ where: { userId_storeId: { userId: user.sub, storeId: user.storeId } } });
      if (m && m.status === "ACTIVE") return user.storeId;
    }
    const first = await prisma.userStore.findFirst({ where: { userId: user.sub, status: "ACTIVE" } });
    if (first) return first.storeId;
    return DEMO_STORE_ID; // legacy demo users without memberships
  }

  /** GET /admin/me — current user summary (no tenant resolution). */
  @Get("me")
  async me(@Req() req: Request & { user?: AuthPrincipal }) {
    const user = req.user;
    if (!user) throw new HttpException({ type: "unauthorized", message: "Not authenticated" }, HttpStatus.UNAUTHORIZED);
    return { id: user.sub, email: user.email, role: user.role, storeId: user.storeId ?? null };
  }

  /** GET /admin/stores/mine — the user's stores (for the switcher). */
  @Get("stores/mine")
  async myStores(@Req() req: Request & { user?: AuthPrincipal }) {
    const user = req.user;
    requireAdmin(user);
    const memberships = await prisma.userStore.findMany({
      where: { userId: user.sub, status: "ACTIVE" },
      include: { store: { select: { id: true, name: true, slug: true } } },
    });
    return { stores: memberships.map((m) => ({ id: m.store.id, name: m.store.name, slug: m.store.slug, role: m.role })) };
  }

  /** GET /admin/stores — all stores (platform admin only). */
  @Get("stores")
  async listStores(@Req() req: Request & { user?: AuthPrincipal }) {
    const user = req.user;
    requireAdmin(user);
    if (user.role !== "PLATFORM_ADMIN") {
      throw new HttpException({ type: "forbidden", message: "Platform admin only" }, HttpStatus.FORBIDDEN);
    }
    return { stores: await this.storesAdmin.listAll() };
  }

  /** POST /admin/stores — create a store + bind owner (platform admin only). */
  @Post("stores")
  async createStore(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: { name: string; slug: string; currencyCode?: string; timezone?: string; ownerEmail: string },
  ) {
    const user = req.user;
    requireAdmin(user);
    if (user.role !== "PLATFORM_ADMIN") {
      throw new HttpException({ type: "forbidden", message: "Platform admin only" }, HttpStatus.FORBIDDEN);
    }
    const result = await this.storesAdmin.create(body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** GET /admin/orders — list recent orders (tenant-scoped). */
  @Get("orders")
  async orders(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireView(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const list = await prisma.order.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
              id: true, orderNumber: true, status: true, totalMinor: true, currencyCode: true,
              customerName: true, customerPhone: true, createdAt: true, paymentStatus: true, source: true,
            },
    });
    return { orders: list, storeId };
  }

  /** GET /admin/orders/:id — full detail (items + history). */
  @Get("orders/:id")
  async orderDetail(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireView(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
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
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireView(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    // Role-based transition permissions: sales agents may only move delivery states.
    const AGENT_ALLOWED = ["OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY"];
    if (user.role === "SALES_AGENT" && !AGENT_ALLOWED.includes(body.toStatus)) {
      throw new HttpException(
        { type: "forbidden", message: "Sales agents may only update delivery states" },
        HttpStatus.FORBIDDEN,
      );
    }
    const result = await this.ordersAdmin.transition(storeId, id, body.toStatus, body.reason, {
      type: user.role,
      id: user.sub,
    });
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return { ...result.value, storeId };
  }

  /** GET /admin/products — tenant-scoped product list with stock. */
  @Get("products")
  async listProducts(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { products: await this.productsAdmin.list(storeId), storeId };
  }

  /** GET /admin/products/categories — store categories. */
  @Get("products/categories")
  async listCategories(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { categories: await this.productsAdmin.listCategories(storeId) };
  }

  /** POST /admin/products — create product. */
  @Post("products")
  async createProduct(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: { name: string; sku: string; priceMinor: number; stock?: number; categorySlug?: string; description?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
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
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.productsAdmin.update(storeId, id, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** DELETE /admin/products/:id — soft delete. */
  @Delete("products/:id")
  async removeProduct(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.productsAdmin.remove(storeId, id);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** GET /admin/settings — store + settings + public link. */
  @Get("settings")
  async getSettings(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const settings = await this.settingsAdmin.get(storeId);
    if (!settings) throw new HttpException({ type: "not_found", message: "Store not found" }, HttpStatus.NOT_FOUND);
    return { ...settings, storeId };
  }

  /** PATCH /admin/settings — update store settings. */
  @Patch("settings")
  async updateSettings(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: {
      allowGuestOrders?: boolean; orderingPaused?: boolean; closedStoreMessage?: string | null;
      minOrderAmountMinor?: number; deliveryFeeMinor?: number; deliveryEnabled?: boolean;
      pickupEnabled?: boolean; orderCutoff?: string | null; maxOpenOrdersPerCustomer?: number;
    },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.settingsAdmin.update(storeId, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return { ...result.value, storeId };
  }

  /** GET /admin/vouchers — list store vouchers with redemption counts. */
  @Get("vouchers")
  async listVouchers(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { vouchers: await this.vouchersAdmin.list(storeId), storeId };
  }

  /** POST /admin/vouchers — create a voucher. */
  @Post("vouchers")
  async createVoucher(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: { code: string; discountMinor: number; minOrderMinor?: number; maxRedemptions?: number | null; startsAt?: string | null; expiresAt?: string | null; description?: string | null },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.vouchersAdmin.create(storeId, {
      code: body.code,
      discountMinor: body.discountMinor,
      minOrderMinor: body.minOrderMinor,
      maxRedemptions: body.maxRedemptions,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      description: body.description,
    });
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** PATCH /admin/vouchers/:id — toggle active or edit discount. */
  @Patch("vouchers/:id")
  async updateVoucher(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: { isActive?: boolean; discountMinor?: number; maxRedemptions?: number | null },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.vouchersAdmin.update(storeId, id, body);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** GET /admin/customers — store customers with loyalty balances. */
  @Get("customers")
  async listCustomers(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const customers = await this.loyalty.adminCustomers(storeId);
    return {
      customers: customers.map((sc) => ({
        id: sc.id,
        customerId: sc.customerId,
        name: sc.customer.name,
        email: sc.customer.email,
        phone: sc.customer.phone,
        approvalStatus: sc.approvalStatus,
        loyaltyPoints: sc.loyaltyBalancePoints,
        creditApproved: sc.creditApproved,
        creditLimitMinor: sc.creditLimitMinor,
        creditBalanceMinor: sc.creditBalanceMinor,
        joinedAt: sc.createdAt,
      })),
      storeId,
    };
  }

  /** GET /admin/customers/:id/loyalty — ledger for one customer. */
  @Get("customers/:id/loyalty")
  async customerLoyalty(@Req() req: Request & { user?: AuthPrincipal }, @Param("id") id: string, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const sc = await prisma.storeCustomer.findFirst({ where: { id, storeId } });
    if (!sc) throw new HttpException({ type: "not_found", message: "Customer not found" }, HttpStatus.NOT_FOUND);
    const ledger = await this.loyalty.customerLedger(storeId, sc.customerId);
    return ledger;
  }

  /** GET /admin/analytics/summary — dashboard KPIs. */
  @Get("analytics/summary")
  async analyticsSummary(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { ...(await this.analytics.summary(storeId)), storeId };
  }

  /** GET /admin/analytics/status — order status funnel. */
  @Get("analytics/status")
  async analyticsStatus(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { rows: await this.analytics.statusBreakdown(storeId), storeId };
  }

  /** GET /admin/analytics/daily?days=14 — revenue + orders per day. */
  @Get("analytics/daily")
  async analyticsDaily(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string, @Headers("days") days?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const n = Math.min(Math.max(parseInt(days ?? "14", 10) || 14, 3), 90);
    return { ...(await this.analytics.dailyRevenue(storeId, n)), storeId };
  }

  /** GET /admin/analytics/products — top products. */
  @Get("analytics/products")
  async analyticsProducts(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { products: await this.analytics.topProducts(storeId), storeId };
  }

  /** GET /admin/analytics/vouchers — voucher usage. */
  @Get("analytics/vouchers")
  async analyticsVouchers(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { vouchers: await this.analytics.voucherUsage(storeId), storeId };
  }

  /** GET /admin/maintenance/stats — cart/order counts (real DB numbers). */
  @Get("maintenance/stats")
  async maintenanceStats(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const [openCarts, expiredCarts, orders] = await Promise.all([
      prisma.cart.count({ where: { storeId, status: "OPEN" } }),
      prisma.cart.count({ where: { storeId, status: "OPEN", expiresAt: { lt: new Date() } } }),
      prisma.order.count({ where: { storeId } }),
    ]);
    return { openCarts, expiredCarts, orders, storeId };
  }

  /** POST /admin/maintenance/sweep-expired-carts — mark expired OPEN carts ABANDONED. */
  @Post("maintenance/sweep-expired-carts")
  async sweepExpiredCarts(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await prisma.cart.updateMany({
      where: { storeId, status: "OPEN", expiresAt: { lt: new Date() } },
      data: { status: "ABANDONED" },
    });
    return { marked: result.count, storeId };
  }

  // ─────────────────────────────── Warehouses / transfers ───────────────────────────────

  /** GET /admin/warehouses — list warehouses. */
  @Get("warehouses")
  async listWarehouses(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { warehouses: await this.warehouses.list(storeId), storeId };
  }

  /** POST /admin/warehouses — create a warehouse (first = default). */
  @Post("warehouses")
  async createWarehouse(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: { name: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.warehouses.create(storeId, body.name);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** POST /admin/warehouses/:id/stock — set a product's stock at a warehouse. */
  @Post("warehouses/:id/stock")
  async setWarehouseStock(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: { productId: string; quantityOnHand: number },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.warehouses.setStock(storeId, id, body.productId, body.quantityOnHand);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** POST /admin/transfers — request a stock transfer. */
  @Post("transfers")
  async requestTransfer(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: { fromWarehouseId: string; toWarehouseId: string; productId: string; quantity: number; reason?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.warehouses.requestTransfer(storeId, body.fromWarehouseId, body.toWarehouseId, body.productId, body.quantity, user.sub, body.reason);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** PATCH /admin/transfers/:id/approve — owner/manager approves. */
  @Patch("transfers/:id/approve")
  async approveTransfer(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireManage(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.warehouses.approveTransfer(storeId, id, user.sub);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** PATCH /admin/transfers/:id/complete — moves the stock (owner/manager). */
  @Patch("transfers/:id/complete")
  async completeTransfer(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireManage(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.warehouses.completeTransfer(storeId, id);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** GET /admin/transfers — list transfers. */
  @Get("transfers")
  async listTransfers(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireView(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { transfers: await this.warehouses.listTransfers(storeId), storeId };
  }

  // ─────────────────────────────── Team (roles) ───────────────────────────────

  /** GET /admin/team — active store members. */
  @Get("team")
  async listTeam(@Req() req: Request & { user?: AuthPrincipal }, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    requireView(user); // everyone in the store can see who's on the team
    const storeId = await this.resolveStoreId(user, headerStoreId);
    return { members: await this.team.list(storeId), storeId };
  }

  /** POST /admin/team/invite — invite MANAGER / STAFF / SALES_AGENT. */
  @Post("team/invite")
  async inviteMember(
    @Req() req: Request & { user?: AuthPrincipal },
    @Body() body: { email: string; name?: string; role: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireManage(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.team.invite(storeId, body.email, body.name ?? null, body.role);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** PATCH /admin/team/:userId/role — change a member's role. */
  @Patch("team/:userId/role")
  async changeMemberRole(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("userId") userId: string,
    @Body() body: { role: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireManage(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.team.changeRole(storeId, userId, body.role);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  /** DELETE /admin/team/:userId — deactivate a member. */
  @Delete("team/:userId")
  async deactivateMember(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("userId") userId: string,
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireManage(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const result = await this.team.deactivate(storeId, userId);
    if (!result.ok) throw new HttpException(result.error, statusFor(result.error));
    return result.value;
  }

  // ─────────────────────────────── Customer approval (CRM) ───────────────────────────────

  /** PATCH /admin/customers/:id/approval — approve/reject/suspend a store customer (audited). */
  @Patch("customers/:id/approval")
  async setCustomerApproval(
    @Req() req: Request & { user?: AuthPrincipal },
    @Param("id") id: string,
    @Body() body: { status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED"; reason?: string },
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    requireAdmin(user);
    const storeId = await this.resolveStoreId(user, headerStoreId);
    const sc = await prisma.storeCustomer.findFirst({ where: { id, storeId } });
    if (!sc) throw new HttpException({ type: "not_found", message: "Customer not found" }, HttpStatus.NOT_FOUND);

    const updated = await prisma.storeCustomer.update({
      where: { id },
      data: { approvalStatus: body.status },
    });
    await prisma.auditLog.create({
      data: {
        storeId,
        actorType: user.role,
        actorId: user.sub,
        action: "CUSTOMER_APPROVAL",
        entityType: "StoreCustomer",
        entityId: id,
        after: { status: body.status, reason: body.reason ?? null },
      },
    });
    return { id, approvalStatus: updated.approvalStatus };
  }
}