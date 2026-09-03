// Store admin service — multi-store: create stores, assign owners, list.

import { randomBytes } from "node:crypto";
import { prisma } from "../persistence/prisma-repositories.js";
import { StoreRole } from "@prisma/client";
import type { ApiError } from "@sam-store/contracts";

export type AdminResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface CreateStoreInput {
  name: string;
  slug: string;
  currencyCode?: string;
  timezone?: string;
  ownerEmail: string; // existing User (store owner) to bind
  ownerRole?: string;
}

export class StoreAdminService {
  /** List all stores (platform admin). */
  async listAll() {
    return prisma.store.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        currencyCode: true,
        timezone: true,
        createdAt: true,
        _count: { select: { products: true, orders: true } },
      },
    });
  }

  /** Create a store + settings + public link + bind the owner membership. */
  async create(input: CreateStoreInput): Promise<AdminResult<{ id: string }>> {
    const name = input.name?.trim() ?? "";
    const slug = input.slug?.trim().toLowerCase() ?? "";
    if (name.length < 2) return { ok: false, error: { type: "validation", errors: ["Store name must be at least 2 characters"] } };
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
      return { ok: false, error: { type: "validation", errors: ["Slug must be 2-40 chars: lowercase letters, digits, hyphens"] } };
    }

    const existingSlug = await prisma.store.findUnique({ where: { slug } });
    if (existingSlug) return { ok: false, error: { type: "conflict", message: "A store with this slug already exists" } };

    const owner = await prisma.user.findUnique({ where: { email: input.ownerEmail.toLowerCase() } });
    if (!owner) return { ok: false, error: { type: "not_found", message: "Owner email must be a registered admin user" } };

    const token = `lnk_${randomBytes(24).toString("base64url")}`;
    const store = await prisma.store.create({
      data: {
        name,
        slug,
        currencyCode: input.currencyCode ?? "PHP",
        timezone: input.timezone ?? "Asia/Manila",
        status: "ACTIVE",
        settings: { create: {} },
        publicLink: { create: { slug, token } },
        userStores: {
          create: { userId: owner.id, role: (input.ownerRole ?? "OWNER") as StoreRole },
        },
      },
    });
    return { ok: true, value: { id: store.id } };
  }
}