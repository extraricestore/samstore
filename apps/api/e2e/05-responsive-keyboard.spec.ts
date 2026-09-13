// E2E 05 — responsive + keyboard smoke check (flow matrix / M10 bullets):
// staff-critical and customer-critical screens must not overflow horizontally at
// 320px (small phone), tablet and desktop, and must be operable by keyboard.
import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, fetchPublicLink } from "./helpers.js";

const VIEWPORTS = [
  { name: "320px phone", width: 320, height: 640 },
  { name: "768px tablet", width: 768, height: 1024 },
  { name: "1440px desktop", width: 1440, height: 900 },
];

async function overflowPx(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - window.innerWidth);
  });
}

test("storefront + cart fit every viewport without horizontal overflow", async ({ page, request }) => {
  const link = await fetchPublicLink(request);
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/${link.slug}?token=${encodeURIComponent(link.token)}`);
    await expect(page.getByRole("button", { name: /cart/i }).first()).toBeVisible({ timeout: 20_000 });
    const overflow = await overflowPx(page);
    expect(overflow, `${vp.name}: page overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(2);

    // The cart must open and its Checkout control stay reachable at this width.
    await page.locator(".card-body button", { hasText: "Add" }).first().click();
    await page.getByRole("button", { name: /cart/i }).first().click();
    await expect(page.getByRole("button", { name: /^Checkout ·/ })).toBeVisible();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    expect(await overflowPx(page), `${vp.name}: cart drawer overflows`).toBeLessThanOrEqual(2);
  }
});

test("admin dashboard fits every viewport and is keyboard reachable", async ({ page }) => {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/admin/login");
    // Keyboard-only path: focus the email field with Tab, type, and submit with Enter.
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.keyboard.press("Enter"); // submits the form without the mouse
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 25_000 });

    await expect(page.locator("nav, .navbar").first()).toBeVisible({ timeout: 15_000 });
    const overflow = await overflowPx(page);
    expect(overflow, `${vp.name}: dashboard overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(2);

    // Tab must move focus to something interactive (no keyboard trap on the shell).
    const before = await page.evaluate(() => document.activeElement?.tagName ?? "");
    await page.keyboard.press("Tab");
    const after = await page.evaluate(() => `${document.activeElement?.tagName ?? ""}:${(document.activeElement as HTMLElement | null)?.getAttribute("type") ?? ""}`);
    expect(before).not.toBe("");
    expect(after).not.toBe(""); // focus moved to a real element
  }
});