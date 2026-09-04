import { Controller, Get, Headers, HttpException, HttpStatus, Inject, Query, Req, Res, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { REPORTS_SERVICE, ReportsService } from "./reports.service.js";

// Decision #9: profit/expense/COGS = OWNER + MANAGER only; sales-level = all admins.
const PROFIT_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER"];
const SALES_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER", "STAFF", "SALES_AGENT"];

function parseRange(from?: string, to?: string, days = 30): { from: Date; to: Date } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - days * 86_400_000);
  return { from: fromDate, to: toDate };
}

@Controller("admin")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(@Inject(REPORTS_SERVICE) private readonly reportsSvc: ReportsService) {}

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

  private requireProfit(user: AuthPrincipal | undefined): asserts user is AuthPrincipal {
    if (!user || !PROFIT_ROLES.includes(user.role)) {
      throw new HttpException({ type: "forbidden", message: "Owner or manager only" }, HttpStatus.FORBIDDEN);
    }
  }

  private requireSales(user: AuthPrincipal | undefined): asserts user is AuthPrincipal {
    if (!user || !SALES_ROLES.includes(user.role)) {
      throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    }
  }

  /** GET /admin/reports/profit?from=&to= — OWNER/MANAGER only (decision #9). */
  @Get("reports/profit")
  async profit(@Req() req: Request & { user?: AuthPrincipal }, @Query("from") from?: string, @Query("to") to?: string, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    this.requireProfit(user);
    const storeId = await this.resolveStore(user, headerStoreId);
    const { from: f, to: t } = parseRange(from, to);
    return { ...(await this.reportsSvc.profitSummary(storeId, f, t)), storeId };
  }

  /** GET /admin/reports/sales?from=&to= — sales-level (all admins incl. staff/agents). */
  @Get("reports/sales")
  async sales(@Req() req: Request & { user?: AuthPrincipal }, @Query("from") from?: string, @Query("to") to?: string, @Headers("x-store-id") headerStoreId?: string) {
    const user = req.user;
    this.requireSales(user);
    const storeId = await this.resolveStore(user, headerStoreId);
    const { from: f, to: t } = parseRange(from, to);
    return { ...(await this.reportsSvc.salesReport(storeId, f, t)), storeId };
  }

  /** GET /admin/reports/profit.csv — CSV export of the profit report (OWNER/MANAGER). */
  @Get("reports/profit.csv")
  async profitCsv(@Req() req: Request & { user?: AuthPrincipal }, @Query("from") from?: string, @Query("to") to?: string, @Headers("x-store-id") headerStoreId?: string, @Res() res?: any) {
    const user = req.user;
    this.requireProfit(user);
    const storeId = await this.resolveStore(user, headerStoreId);
    const { from: f, to: t } = parseRange(from, to);
    const r = await this.reportsSvc.profitSummary(storeId, f, t);
    const rows = [
      ["metric", "minor", "pesos"],
      ["revenue", r.revenueMinor, (r.revenueMinor / 100).toFixed(2)],
      ["refunds", r.refundsMinor, (r.refundsMinor / 100).toFixed(2)],
      ["netRevenue", r.netRevenueMinor, (r.netRevenueMinor / 100).toFixed(2)],
      ["cogs", r.cogsMinor, (r.cogsMinor / 100).toFixed(2)],
      ["expenses", r.expensesMinor, (r.expensesMinor / 100).toFixed(2)],
      ["profit", r.profitMinor, (r.profitMinor / 100).toFixed(2)],
      ["orders", r.ordersCount, ""],
    ];
    const csv = rows.map((row) => row.join(",")).join("\n");
    res?.setHeader?.("Content-Type", "text/csv; charset=utf-8");
    res?.setHeader?.("Content-Disposition", `attachment; filename="profit-${f.toISOString().slice(0, 10)}-${t.toISOString().slice(0, 10)}.csv"`);
    return res?.send?.(csv) ?? csv;
  }
}