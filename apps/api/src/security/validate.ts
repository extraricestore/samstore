// Runtime DTO validation at the API boundary (Module 2 fix).
// NestJS is used WITHOUT class-validator/class-transformer here, so request bodies
// were previously trusted and only checked (unevenly) inside services. This module
// gives every untrusted boundary — public storefront, cart, checkout, claim, auth —
// the same dependency-free schema check, returning the ApiError "validation" shape
// so the UI can show field-level messages instead of a 500.
//
// Rule of thumb: validate SHAPE and TYPES here (and reject unknown keys — a typo
// silently dropped is how client-controlled fields sneak in); business rules stay
// in the domain services.

export interface StringRule {
  kind: "string";
  required?: boolean;
  min?: number;
  max?: number;
  /** Exact allowed values (enum). */
  values?: readonly string[];
  pattern?: RegExp;
  patternMessage?: string;
  trim?: boolean;
}

export interface IntRule {
  kind: "int";
  required?: boolean;
  min?: number;
  max?: number;
}

export interface BoolRule {
  kind: "bool";
  required?: boolean;
}

export interface ObjectRule {
  kind: "object";
  fields: Record<string, Rule>;
  /** Reject keys that are not declared (default true). */
  allowUnknown?: boolean;
}

export type Rule = StringRule | IntRule | BoolRule | ObjectRule;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function checkOne(value: unknown, rule: Rule, path: string, errors: string[]): unknown {
  switch (rule.kind) {
    case "string": {
      if (value === undefined || value === null || value === "") {
        if (rule.required) errors.push(`${path} is required`);
        return undefined;
      }
      if (typeof value !== "string") {
        errors.push(`${path} must be a string`);
        return undefined;
      }
      const v = rule.trim === false ? value : value.trim();
      if (rule.min !== undefined && v.length < rule.min) {
        errors.push(`${path} must be at least ${rule.min} characters`);
        return undefined;
      }
      if (rule.max !== undefined && v.length > rule.max) {
        errors.push(`${path} must be at most ${rule.max} characters`);
        return undefined;
      }
      if (rule.values && !rule.values.includes(v)) {
        errors.push(`${path} must be one of: ${rule.values.join(", ")}`);
        return undefined;
      }
      if (rule.pattern && !rule.pattern.test(v)) {
        errors.push(rule.patternMessage ?? `${path} has an invalid format`);
        return undefined;
      }
      return v;
    }
    case "int": {
      if (value === undefined || value === null || value === "") {
        if (rule.required) errors.push(`${path} is required`);
        return undefined;
      }
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${path} must be an integer`);
        return undefined;
      }
      if (rule.min !== undefined && value < rule.min) {
        errors.push(`${path} must be at least ${rule.min}`);
        return undefined;
      }
      if (rule.max !== undefined && value > rule.max) {
        errors.push(`${path} must be at most ${rule.max}`);
        return undefined;
      }
      return value;
    }
    case "bool": {
      if (value === undefined || value === null) {
        if (rule.required) errors.push(`${path} is required`);
        return undefined;
      }
      if (typeof value !== "boolean") {
        errors.push(`${path} must be a boolean`);
        return undefined;
      }
      return value;
    }
    case "object": {
      if (value === undefined || value === null) {
        errors.push(`${path} is required`);
        return undefined;
      }
      if (typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${path} must be an object`);
        return undefined;
      }
      return checkDto(value as Record<string, unknown>, rule, path).ok
        ? (value as Record<string, unknown>)
        : undefined;
    }
  }
}

/** Validate an object against declared fields. Collects ALL errors, not just the first. */
export function checkDto<T = Record<string, unknown>>(
  input: unknown,
  rule: ObjectRule,
  pathPrefix = "",
): ValidationResult<T> {
  const errors: string[] = [];
  if (input === undefined || input === null) {
    return { ok: false, errors: [pathPrefix ? `${pathPrefix} is required` : "body is required"] };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: [pathPrefix ? `${pathPrefix} must be an object` : "body must be an object"] };
  }

  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, fieldRule] of Object.entries(rule.fields)) {
    const value = checkOne(raw[key], fieldRule, pathPrefix ? `${pathPrefix}.${key}` : key, errors);
    if (value !== undefined) out[key] = value;
  }

  if (rule.allowUnknown === false || rule.allowUnknown === undefined) {
    for (const key of Object.keys(raw)) {
      if (!(key in rule.fields)) {
        errors.push(pathPrefix ? `${pathPrefix}.${key} is not an allowed field` : `${key} is not an allowed field`);
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: out as T };
}

// ── shared schemas for the untrusted public/auth surface ──────────────────────
import { HttpException, HttpStatus } from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";

/**
 * Validate-or-throw for a controller boundary: bad shape → 422 in the standard
 * ApiError "validation" form (the UI shows `errors`), never a 500.
 */
export function assertDto<T>(input: unknown, rule: ObjectRule): T {
  const result = checkDto<T>(input, rule);
  if (!result.ok) {
    const error: ApiError = { type: "validation", errors: result.errors };
    throw new HttpException(error, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return result.value;
}


export const CHECKOUT_DTO: ObjectRule = {
  kind: "object",
  fields: {
    cartToken: { kind: "string", required: true, min: 8, max: 200 },
    customerName: { kind: "string", required: true, min: 2, max: 120 },
    customerPhone: { kind: "string", required: true, min: 7, max: 32 },
    deliveryType: { kind: "string", values: ["delivery", "pickup"] },
    paymentMethod: { kind: "string", values: ["cod", "credit"] },
    idempotencyKey: { kind: "string", required: true, min: 8, max: 200 },
    deliveryAddressLine1: { kind: "string", max: 200 },
    deliveryAddressLine2: { kind: "string", max: 200 },
    landmark: { kind: "string", max: 200 },
    deliverySchedule: { kind: "string", max: 120 },
    notes: { kind: "string", max: 500 },
    voucherCode: { kind: "string", max: 64 },
    customerToken: { kind: "string", max: 4096 },
    loyaltyPoints: { kind: "int", min: 0, max: 10_000_000 },
  },
};

export const CART_ADD_DTO: ObjectRule = {
  kind: "object",
  fields: {
    productId: { kind: "string", required: true, min: 8, max: 64 },
    quantity: { kind: "int", required: true, min: 1, max: 999 },
  },
};

export const CART_QTY_DTO: ObjectRule = {
  kind: "object",
  fields: { quantity: { kind: "int", required: true, min: 0, max: 999 } },
};

export const CLAIM_DTO: ObjectRule = {
  kind: "object",
  fields: { claimToken: { kind: "string", required: true, min: 8, max: 4096 } },
};

export const LOGIN_DTO: ObjectRule = {
  kind: "object",
  fields: {
    email: { kind: "string", required: true, min: 3, max: 254 },
    password: { kind: "string", required: true, min: 1, max: 200, trim: false },
  },
};

export const REGISTER_DTO: ObjectRule = {
  kind: "object",
  fields: {
    email: { kind: "string", required: true, min: 3, max: 254 },
    password: { kind: "string", required: true, min: 8, max: 200, trim: false },
    name: { kind: "string", max: 120 },
  },
};

export const CHANGE_PASSWORD_DTO: ObjectRule = {
  kind: "object",
  fields: {
    email: { kind: "string", required: true, min: 3, max: 254 },
    currentPassword: { kind: "string", required: true, min: 1, max: 200, trim: false },
    newPassword: { kind: "string", required: true, min: 8, max: 200, trim: false },
  },
};
