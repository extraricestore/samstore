import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AuthService } from "./auth.service.js";
import type { AuthUserRecord, AuthRepository } from "./auth.repository.js";
import { hashPassword } from "./auth.domain.js";

class InMemoryAuthRepo implements AuthRepository {
  private users = new Map<string, AuthUserRecord>();
  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.users.get(email.toLowerCase()) ?? null;
  }
  async createUser(email: string, passwordHash: string, name: string | null, role: string): Promise<AuthUserRecord> {
    const user: AuthUserRecord = {
      id: randomUUID(),
      email: email.toLowerCase(),
      passwordHash,
      name,
      role,
      memberships: [],
    };
    this.users.set(user.email, user);
    return user;
  }
  seed(user: AuthUserRecord) {
    this.users.set(user.email, user);
  }
}

const CONFIG = { jwtSecret: "test-secret-0123456789", jwtExpiresIn: "1h" };

function makeService() {
  const repo = new InMemoryAuthRepo();
  return { svc: new AuthService(repo, CONFIG), repo };
}

test("register creates a user and returns a JWT", async () => {
  const { svc } = makeService();
  const r = await svc.register({ email: "Owner@Store.com", password: "password123", name: "Sam Owner" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.user.email, "owner@store.com"); // lowercased
  assert.match(r.value.token, /^eyJ/); // JWT header
});

test("register rejects invalid email and short password", async () => {
  const { svc } = makeService();
  assert.equal((await svc.register({ email: "not-an-email", password: "password123" })).ok, false);
  assert.equal((await svc.register({ email: "a@b.com", password: "short" })).ok, false);
});

test("register rejects duplicate email", async () => {
  const { svc } = makeService();
  await svc.register({ email: "dup@store.com", password: "password123" });
  const r = await svc.register({ email: "DUP@store.com", password: "password456" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "conflict");
});

test("login succeeds with correct password and fails with wrong", async () => {
  const { svc, repo } = makeService();
  const hash = await hashPassword("correct-horse");
  repo.seed({ id: "u1", email: "staff@store.com", passwordHash: hash, name: "Staff", role: "STAFF", memberships: [{ storeId: "s1", role: "STAFF" }] });
  const ok = await svc.login({ email: "staff@store.com", password: "correct-horse" });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.match(ok.value.token, /^eyJ/);
  assert.equal(ok.value.user.name, "Staff");

  const bad = await svc.login({ email: "staff@store.com", password: "wrong" });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.equal(bad.error.type, "unauthorized");
});

test("login with unknown email is unauthorized", async () => {
  const { svc } = makeService();
  const r = await svc.login({ email: "ghost@store.com", password: "whatever" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.type, "unauthorized");
});

test("jwt signing and verification round-trips claims", async () => {
  const { signToken, verifyToken } = await import("./auth.domain.js");
  const token = signToken({ sub: "u1", role: "STORE_OWNER", email: "a@b.com", storeId: "s1" }, CONFIG);
  const decoded = verifyToken(token, CONFIG);
  assert.equal(decoded.sub, "u1");
  assert.equal(decoded.storeId, "s1");
});