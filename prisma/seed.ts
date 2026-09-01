// Demo seed for the Thin Slice — run with: npx tsx prisma/seed.ts
// Creates one store, settings, public link, categories, products, stock, and a demo cart.
// Destructive? No — upserts by stable slugs/tokens; safe to re-run.

import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.upsert({
    where: { slug: "sam-store" },
    update: {},
    create: {
      slug: "sam-store",
      name: "Sam's Store",
      currencyCode: "PHP",
      timezone: "Asia/Manila",
      status: "ACTIVE",
      settings: {
        create: {
          deliveryFeeMinor: 5000,
          minOrderAmountMinor: 0,
          allowGuestOrders: true,
        },
      },
      publicLink: {
        create: {
          slug: "sam-store",
          token: `lnk_${randomUUID().replace(/-/g, "")}`,
        },
      },
    },
  });

  const drinks = await prisma.category.upsert({
    where: { storeId_slug: { storeId: store.id, slug: "drinks" } },
    update: {},
    create: { storeId: store.id, name: "Drinks", slug: "drinks", sortOrder: 1 },
  });

  const snackable = await prisma.category.upsert({
    where: { storeId_slug: { storeId: store.id, slug: "snacks" } },
    update: {},
    create: { storeId: store.id, name: "Snacks", slug: "snacks", sortOrder: 2 },
  });

  const products = [
    {
      sku: "KAPE-001",
      name: "Kape Barako",
      description: "Strong Filipino coffee",
      priceMinor: 12000,
      categoryId: drinks.id,
      stock: 50,
    },
    {
      sku: "TURON-001",
      name: "Turon (4 pcs)",
      description: "Fried banana rolls with caramelized sugar",
      priceMinor: 8000,
      categoryId: snackable.id,
      stock: 30,
    },
    {
      sku: "BIBINGKA-001",
      name: "Bibingka",
      description: "Rice cake with salted egg and cheese",
      priceMinor: 15000,
      categoryId: snackable.id,
      stock: 20,
    },
  ];

  const productIds: string[] = [];
  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { storeId_sku: { storeId: store.id, sku: p.sku } },
      update: { priceMinor: p.priceMinor },
      create: {
        storeId: store.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        priceMinor: p.priceMinor,
        categoryId: p.categoryId,
        stockLevel: { create: { storeId: store.id, quantityOnHand: p.stock } },
      },
    });
    productIds.push(product.id);
  }

  // Demo guest cart (use this token for manual checkout tests).
  await prisma.cart.upsert({
    where: { token: "cart-demo-token" },
    update: {},
    create: {
      storeId: store.id,
      token: "cart-demo-token",
      status: "OPEN",
      items: {
        create: [
          {
            storeId: store.id,
            productId: productIds[0]!,
            quantity: 2,
            unitPriceMinor: 12000,
          },
          {
            storeId: store.id,
            productId: productIds[1]!,
            quantity: 1,
            unitPriceMinor: 8000,
          },
        ],
      },
    },
  });

  const link = await prisma.publicStoreLink.findUnique({
    where: { storeId: store.id },
  });

  console.log("Seed complete:");
  console.log(`  store:   sam-store (${store.id})`);
  console.log(`  link:    sam-store + token ${link?.token ?? "(missing)"}`);
  console.log(`  products: ${products.map((p) => p.sku).join(", ")}`);
  console.log(`  demo cart token: cart-demo-token`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());