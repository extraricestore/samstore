import { Controller, Get, Headers, HttpException, HttpStatus, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, type AuthPrincipal } from "../auth/auth.guard.js";
import { resolveTenant, TENANT_ROLES } from "../auth/tenant-context.js";
import { prisma } from "../persistence/prisma-repositories.js";
import { INVENTORY_SERVICE, InventoryService } from "./inventory.service.js";

@Controller("admin")
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(@Inject(INVENTORY_SERVICE) private readonly inventorySvc: InventoryService) {}

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
    const { storeId } = await resolveTenant(user, headerStoreId, TENANT_ROLES.ADMIN);
    const data = await this.inventorySvc.list(storeId, { search, categoryId, warehouseId, status });
    const warehouses = await prisma.warehouse.findMany({ where: { storeId }, select: { id: true, name: true, isDefault: true } });
    const categories = await prisma.category.findMany({ where: { storeId, isActive: true }, select: { id: true, name: true } });
    return { ...data, warehouses, categories };
  }
}