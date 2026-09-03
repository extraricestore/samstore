// Product admin validation — pure functions, unit-testable.

export interface ProductInput {
  name: string;
  sku: string;
  priceMinor: number;
  stock?: number;
  categorySlug?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export type ProductValidation = { ok: true } | { ok: false; errors: string[] };

export function validateProductInput(input: ProductInput): ProductValidation {
  const errors: string[] = [];

  if (!input.name || input.name.trim().length < 2) {
    errors.push("name must be at least 2 characters");
  } else if (input.name.length > 120) {
    errors.push("name must be at most 120 characters");
  }

  if (!input.sku || input.sku.trim().length < 2) {
    errors.push("sku is required (min 2 characters)");
  } else if (input.sku.length > 60) {
    errors.push("sku must be at most 60 characters");
  }

  if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) {
    errors.push("priceMinor must be a non-negative integer");
  }

  if (input.stock !== undefined) {
    if (!Number.isInteger(input.stock) || input.stock < 0) {
      errors.push("stock must be a non-negative integer");
    }
  }

  if (input.description && input.description.length > 500) {
    errors.push("description must be at most 500 characters");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}