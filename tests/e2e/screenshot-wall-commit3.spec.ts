/**
 * One-shot spec: captures a 1440×900 screenshot of the board in player_turn phase.
 * Used for visual review of the wall layout after Commit 3.
 * Delete this file after review is complete.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
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

async function joinGame(ctx: BrowserContext, lobbyUrl: string, name: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(lobbyUrl);
  await page.getByRole("button", { name: "Play" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  return page;
}

test("wall layout screenshot — board phase", async ({ browser }) => {
  test.setTimeout(300_000);

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  const hostCtx = await browser.newContext();
  contexts.push(hostCtx);
  const { page: hostPage, lobbyUrl } = await createGame(hostCtx, "P1");
  pages.push(hostPage);

  for (let i = 2; i <= 6; i++) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const p = await joinGame(ctx, lobbyUrl, `P${i}`);
    pages.push(p);
  }

  // Wait for Start Game button (all 6 players joined)
  await expect(hostPage.getByRole("button", { name: "Start Game" })).toBeVisible({ timeout: 20_000 });

  // Start game
  await hostPage.getByRole("button", { name: "Start Game" }).click();

  // Wait for host to navigate to game page (not lobby)
  await hostPage.waitForURL(/\/game\/[^/]+$/, { timeout: 30_000 });
  await hostPage.waitForTimeout(3_000);

  // Capture board state (likely mission_selection or card_reveal)
  const snap1 = path.join("C:/tmp", "wall-commit3-snap1.png");
  await hostPage.screenshot({ path: snap1, fullPage: false });

  // Try to find an AI player page and capture it too
  let aiPage: Page | null = null;
  for (let i = 1; i < pages.length; i++) {
    try {
      await pages[i].waitForURL(/\/game\/[^/]+$/, { timeout: 8_000 });
      await pages[i].waitForTimeout(1_000);
      aiPage = pages[i];
      break;
    } catch { /* continue */ }
  }
  if (aiPage) {
    await aiPage.screenshot({ path: path.join("C:/tmp", "wall-commit3-ai-snap1.png"), fullPage: false });
  }

  // Navigate through mission_selection
  for (const p of pages) {
    try {
      const btn = p.getByRole("button", { name: /Select|Confirm/i });
      if (await btn.isVisible({ timeout: 2_000 })) {
        await btn.click();
        break;
      }
    } catch { /* continue */ }
  }
  await hostPage.waitForTimeout(3_000);

  // card_reveal: each AI reveals
  for (const p of pages) {
    try {
      const btn = p.getByRole("button", { name: /Reveal/i });
      if (await btn.isVisible({ timeout: 2_000 })) await btn.click();
    } catch { /* continue */ }
  }
  await hostPage.waitForTimeout(3_000);

  // resource_allocation: human confirms
  for (const p of pages) {
    try {
      const btn = p.getByRole("button", { name: /Confirm|Allocate/i });
      if (await btn.isVisible({ timeout: 2_000 })) { await btn.click(); break; }
    } catch { /* continue */ }
  }
  await hostPage.waitForTimeout(5_000);

  // Final player_turn screenshot
  await hostPage.screenshot({ path: path.join("C:/tmp", "wall-commit3-player-turn-host.png"), fullPage: false });
  if (aiPage) {
    await aiPage.screenshot({ path: path.join("C:/tmp", "wall-commit3-player-turn-ai.png"), fullPage: false });
  }

  for (const ctx of contexts) {
    await ctx.close().catch(() => {});
  }
});
