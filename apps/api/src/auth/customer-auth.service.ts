// Customer auth — password-based customer accounts (email + password).
// Issues a JWT with role CUSTOMER; the customer's per-store loyalty/profile is
// created lazily at checkout / claim (guests remain anonymous).

import { prisma } from "../persistence/prisma-repositories.js";
import { hashPassword, verifyPassword, signToken, type AuthConfig } from "./auth.domain.js";
import type { ApiError } from "@sam-store/contracts";

export type CustomerAuthResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** DI token. */
export const CUSTOMER_AUTH_SERVICE = Symbol("CUSTOMER_AUTH_SERVICE");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CustomerAuthService {
  constructor(private readonly config: AuthConfig) {}

  async register(input: { email: string; password: string; name?: string; phone?: string }): Promise<
    CustomerAuthResult<{ token: string; customer: { id: string; email: string; name: string | null } }>
  > {
    const email = input.email?.trim().toLowerCase() ?? "";
    if (!EMAIL_RE.test(email)) {
      return { ok: false, error: { type: "validation", errors: ["A valid email is required"] } };
    }
    if (!input.password || input.password.length < 8) {
      return { ok: false, error: { type: "validation", errors: ["Password must be at least 8 characters"] } };
    }
    const existing = await prisma.customer.findFirst({ where: { email } });
    if (existing) return { ok: false, error: { type: "conflict", message: "Email already registered" } };

    const passwordHash = await hashPassword(input.password);
    const customer = await prisma.customer.create({
      data: { email, passwordHash, name: input.name?.trim() ?? null, phone: input.phone?.trim() ?? null },
    });

    const token = signToken({ sub: customer.id, role: "CUSTOMER", email: customer.email ?? "" }, this.config);
    return { ok: true, value: { token, customer: { id: customer.id, email: customer.email ?? "", name: customer.name } } };
  }

  async login(input: { email: string; password: string }): Promise<
    CustomerAuthResult<{ token: string; customer: { id: string; email: string; name: string | null } }>
  > {
    const email = input.email?.trim().toLowerCase() ?? "";
    const customer = await prisma.customer.findFirst({ where: { email } });
    if (!customer || !customer.passwordHash) {
      return { ok: false, error: { type: "unauthorized", message: "Invalid email or password" } };
    }
    const valid = await verifyPassword(input.password ?? "", customer.passwordHash);
    if (!valid) return { ok: false, error: { type: "unauthorized", message: "Invalid email or password" } };

    const token = signToken({ sub: customer.id, role: "CUSTOMER", email: customer.email ?? "" }, this.config);
    return { ok: true, value: { token, customer: { id: customer.id, email: customer.email ?? "", name: customer.name } } };
  }
}