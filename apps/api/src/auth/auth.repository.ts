// Auth repository — user persistence.

import { prisma } from "../persistence/prisma-repositories.js";
import { StoreRole } from "@prisma/client";

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  role: string;
  /** store memberships: storeId + role */
  memberships: { storeId: string; role: string }[];
}

export interface AuthRepository {
  findByEmail(email: string): Promise<AuthUserRecord | null>;
  createUser(
    email: string,
    passwordHash: string,
    name: string | null,
    role: string,
    storeBinding?: { storeId: string; role: string },
  ): Promise<AuthUserRecord>;
}

export class PrismaAuthRepository implements AuthRepository {
  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const u = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { memberships: { select: { storeId: true, role: true } } },
    });
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      passwordHash: u.passwordHash,
      name: u.name,
      role: u.role ?? "STORE_OWNER",
      memberships: u.memberships.map((m) => ({ storeId: m.storeId, role: m.role })),
    };
  }

  async createUser(
    email: string,
    passwordHash: string,
    name: string | null,
    role: string,
    storeBinding?: { storeId: string; role: string },
  ): Promise<AuthUserRecord> {
    const u = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        role,
        ...(storeBinding
          ? {
              memberships: {
                create: { storeId: storeBinding.storeId, role: storeBinding.role as StoreRole },
              },
            }
          : {}),
      },
      include: { memberships: { select: { storeId: true, role: true } } },
    });
    return {
      id: u.id,
      email: u.email,
      passwordHash: u.passwordHash,
      name: u.name,
      role: u.role,
      memberships: u.memberships.map((m) => ({ storeId: m.storeId, role: m.role })),
    };
  }
}