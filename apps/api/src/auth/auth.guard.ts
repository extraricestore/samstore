// NestJS guard — authenticates the Bearer token and exposes the principal.
// Returns the verified token (the passport for tenant-scoped authorization).

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";
import { verifyToken, InvalidTokenError } from "./auth.domain.js";

export interface AuthPrincipal {
  sub: string;
  role: string;
  email: string;
  storeId?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject("AUTH_CONFIG") private readonly config: { jwtSecret: string }) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException("Missing bearer token");
    try {
      const verified = verifyToken(token, { jwtSecret: this.config.jwtSecret, jwtExpiresIn: "7d" });
      (req as unknown as { user: AuthPrincipal }).user = {
        sub: verified.sub,
        role: verified.role,
        email: verified.email,
        storeId: verified.storeId,
      };
      return true;
    } catch (e) {
      if (e instanceof InvalidTokenError) throw new UnauthorizedException(e.message);
      throw e;
    }
  }
}