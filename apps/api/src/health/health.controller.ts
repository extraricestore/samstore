import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { prisma } from "../persistence/prisma-repositories.js";

/** Module 11 — liveness/readiness: /health (no DB) and /health/ready (DB ping). */
@Controller("health")
export class HealthController {
  @Get()
  async liveness() {
    return { status: "ok", uptimeSec: Math.round(process.uptime?.() ?? 0) };
  }

  @Get("ready")
  async readiness() {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      return { status: "ready", db: "ok" };
    } catch {
      throw new HttpException({ status: "degraded", db: "error" }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}