// Auth service — register/login and JWT issuance.

import type { ApiError } from "@sam-store/contracts";
import { hashPassword, verifyPassword, signToken, AuthConfig } from "./auth.domain.js";
import { PrismaAuthRepository, type AuthRepository } from "./auth.repository.js";

export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** DI token. */
export const AUTH_SERVICE = Symbol("AUTH_SERVICE");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ALLOWED_ROLES = ["STORE_OWNER", "PLATFORM_ADMIN", "MANAGER", "STAFF", "SALES_AGENT"] as const;

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly config: AuthConfig,
  ) {}

  async register(input: {
    email: string;
    password: string;
    name?: string;
    storeId?: string;
    role?: string;
  }): Promise<AuthResult<{ token: string; user: { id: string; email: string; name: string | null } }>> {
    const email = input.email?.trim().toLowerCase() ?? "";
    if (!EMAIL_RE.test(email)) {
      return { ok: false, error: { type: "validation", errors: ["A valid email is required"] } };
    }
    if (!input.password || input.password.length < 8) {
      return { ok: false, error: { type: "validation", errors: ["Password must be at least 8 characters"] } };
    }
    const role = input.role ?? "STORE_OWNER";
    if (!(ALLOWED_ROLES as readonly string[]).includes(role)) {
      return { ok: false, error: { type: "validation", errors: [`Unknown role: ${role}`] } };
    }

    const existing = await this.repo.findByEmail(email);
    if (existing) return { ok: false, error: { type: "conflict", message: "Email already registered" } };

    const passwordHash = await hashPassword(input.password);
    const user = await this.repo.createUser(
      email,
      passwordHash,
      input.name ?? null,
      role,
      input.storeId ? { storeId: input.storeId, role: "OWNER" } : undefined,
    );

    const token = signToken(
      {
        sub: user.id,
        role: user.role,
        email: user.email,
        storeId: input.storeId ?? undefined,
      },
      this.config,
    );
    return {
      ok: true,
      value: { token, user: { id: user.id, email: user.email, name: user.name } },
    };
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<AuthResult<{ token: string; user: { id: string; email: string; name: string | null } }>> {
    const email = input.email?.trim().toLowerCase() ?? "";
    const user = await this.repo.findByEmail(email);
    if (!user) return { ok: false, error: { type: "unauthorized", message: "Invalid email or password" } };
    const valid = await verifyPassword(input.password ?? "", user.passwordHash);
    if (!valid) return { ok: false, error: { type: "unauthorized", message: "Invalid email or password" } };

    const token = signToken(
      {
        sub: user.id,
        role: user.role,
        email: user.email,
        storeId: user.memberships[0]?.storeId,
      },
      this.config,
    );
    return {
      ok: true,
      value: { token, user: { id: user.id, email: user.email, name: user.name } },
    };
  }
}