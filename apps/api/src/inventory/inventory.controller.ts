import { Controller, Get, Headers, HttpException, HttpStatus, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { INVENTORY_SERVICE, InventoryService } from "./inventory.service.js";

const ADMIN_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER", "STAFF"];

@Controller("admin")
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(@Inject(INVENTORY_SERVICE) private readonly inventorySvc: InventoryService) {}

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

  /** GET /admin/inventory?search=&categoryId=&warehouseId=&status=in|low|out */
  @Get("inventory")
  async list(
    @Req() req: Request & { user?: AuthPrincipal },
    @Query("search") search?: string,
    @Query("categoryId") categoryId?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("status") status?: "in" | "low" | "out",
    @Headers("x-store-id") headerStoreId?: string,
  ) {
    const user = req.user;
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new HttpException({ type: "forbidden", message: "Not authorized" }, HttpStatus.FORBIDDEN);
    const storeId = await this.resolveStore(user, headerStoreId);
    const data = await this.inventorySvc.list(storeId, { search, categoryId, warehouseId, status });
    const warehouses = await prisma.warehouse.findMany({ where: { storeId }, select: { id: true, name: true, isDefault: true } });
    const categories = await prisma.category.findMany({ where: { storeId, isActive: true }, select: { id: true, name: true } });
    return { ...data, warehouses, categories };
  }
}