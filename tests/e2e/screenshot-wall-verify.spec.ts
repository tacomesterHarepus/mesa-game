/**
 * Visual verification — resource_allocation phase to check Q2 (+/- buttons vs wall gap).
 * Uses Fill Lobby so all bots share the host's user_id → devMode switching works.
 * Delete after review.
 */
import { test, type BrowserContext, type Page } from "@playwright/test";
import * as path from "path";

async function createGame(ctx: BrowserContext, name: string): Promise<{ page: Page; lobbyUrl: string }> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/game/create");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create Game" }).click();
  await page.waitForURL("**/game/**/lobby", { timeout: 15_000 });
  return { page, lobbyUrl: page.url() };
}

/** Dismiss role reveal modal — waits for it to appear, then clicks Acknowledge */
async function dismissModal(page: Page): Promise<void> {
  try {
    const btn = page.getByRole("button", { name: /Acknowledge/i });
    await btn.waitFor({ state: "visible", timeout: 4_000 });
    await btn.click();
    await btn.waitFor({ state: "hidden", timeout: 3_000 });
  } catch { /* no modal or already gone */ }
}

/** Click a DevMode player button matching a role suffix (H, A, M) */
async function devSwitch(page: Page, suffix: string): Promise<void> {
  const switcher = page.locator(".fixed.top-7");
  const btns = switcher.getByRole("button");
  const count = await btns.count();
  for (let i = 0; i < count; i++) {
    const label = await btns.nth(i).textContent();
    if (label?.endsWith(suffix)) {
      await btns.nth(i).click();
      await page.waitForTimeout(600);
      await dismissModal(page);
      return;
    }
  }
}

test("Q2 verification — resource_allocation +/- buttons vs wall gap", async ({ browser }) => {
  test.setTimeout(300_000);

  // Create host — stays on lobby page
  const hostCtx = await browser.newContext();
  const { page: hostPage } = await createGame(hostCtx, "P1");

  // Fill lobby with bots (all share host user_id → devMode switching works)
  await hostPage.getByRole("button", { name: "Fill Lobby" }).click();
  await hostPage.waitForTimeout(2_000);

  // Start game
  await hostPage.getByRole("button", { name: "Start Game" }).waitFor({ state: "visible", timeout: 15_000 });
  await hostPage.getByRole("button", { name: "Start Game" }).click();

  // Game page URL will have ?dev_mode=true
  await hostPage.waitForURL(/\/game\/[^/]+(?:\?|$)/, { timeout: 30_000 });
  await hostPage.waitForTimeout(2_500);

  // Dismiss host's own role reveal modal
  await dismissModal(hostPage);

  // ── mission_selection: switch to a human player, select a mission ─────────
  await devSwitch(hostPage, "H");

  // Click first enabled mission candidate, then Select Mission
  await hostPage.locator("button.w-full.text-left").first().click({ timeout: 5_000 });
  await hostPage.waitForTimeout(400);
  await hostPage.getByRole("button", { name: "Select Mission" }).click({ timeout: 5_000 });
  await hostPage.waitForTimeout(2_000);

  // ── card_reveal: use "Reveal All" dev shortcut ────────────────────────────
  const revealAll = hostPage.getByRole("button", { name: "Reveal All" });
  if (await revealAll.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await revealAll.click();
    await hostPage.waitForTimeout(3_000);
  }

  // ── resource_allocation: take screenshots ─────────────────────────────────
  // Switch to human view (resource controls visible only to humans)
  await devSwitch(hostPage, "H");

  await hostPage.screenshot({ path: path.join("C:/tmp", "verify-resource-alloc-human.png"), fullPage: false });

  // Also switch to an AI view (shows chip cluster without action UI)
  await devSwitch(hostPage, "A");
  await hostPage.screenshot({ path: path.join("C:/tmp", "verify-resource-alloc-ai.png"), fullPage: false });

  const phaseText = await hostPage.locator("span").filter({ hasText: /PHASE/ }).first().textContent().catch(() => "?");
  console.log("Phase:", phaseText);

  await hostCtx.close().catch(() => {});
});
