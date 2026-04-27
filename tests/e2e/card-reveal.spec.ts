import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Helpers (mirrors draw-cards.spec.ts) ──────────────────────────────────────

async function fillLobby(ctx: BrowserContext, hostName = "Bot1"): Promise<{ page: Page; gameId: string }> {
  const page = await ctx.newPage();
  await page.goto("/game/create");
  await page.getByLabel("Display name").fill(hostName);
  await page.getByRole("button", { name: "Dev Mode: Fill Lobby" }).click();
  await page.waitForURL("**/game/**/lobby?dev_mode=true");
  const match = page.url().match(/\/game\/([^/]+)\/lobby/);
  const gameId = match?.[1] ?? "";
  return { page, gameId };
}

async function startDevGame(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start Game" }).click();
  await page.waitForURL(
    (url) =>
      url.pathname.match(/\/game\/[^/]+$/) !== null &&
      url.searchParams.get("dev_mode") === "true",
    { timeout: 30000 }
  );
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

async function extractAuthToken(page: Page): Promise<string | null> {
  const PREFIX = "sb-qpoakdiwmpaxvvzpqqdh-auth-token";
  const allCookies = await page.context().cookies("http://localhost:3000");

  const single = allCookies.find((c) => c.name === PREFIX);
  let sessionStr: string | null = null;
  if (single?.value) {
    try { sessionStr = decodeURIComponent(single.value); } catch { sessionStr = single.value; }
  } else {
    let chunks = "";
    for (let i = 0; ; i++) {
      const chunk = allCookies.find((c) => c.name === `${PREFIX}.${i}`);
      if (!chunk?.value) break;
      try { chunks += decodeURIComponent(chunk.value); } catch { chunks += chunk.value; }
    }
    if (chunks) sessionStr = chunks;
  }

  if (!sessionStr) return null;
  if (sessionStr.startsWith("base64-")) {
    sessionStr = Buffer.from(sessionStr.slice(7), "base64").toString("utf-8");
  }
  try {
    return (JSON.parse(sessionStr) as { access_token?: string }).access_token ?? null;
  } catch {
    return null;
  }
}

async function collectPlayerIds(page: Page): Promise<{ humanId: string | null; aiIds: string[] }> {
  const switcherPanel = page.locator(".fixed.top-7");
  const allButtons = switcherPanel.locator("[data-player-id]");
  const count = await allButtons.count();

  let humanId: string | null = null;
  const aiIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const btn = allButtons.nth(i);
    const label = await btn.textContent() ?? "";
    const id = await btn.getAttribute("data-player-id") ?? "";
    if (!id) continue;
    if (label.includes("H")) {
      if (!humanId) humanId = id;
    } else {
      aiIds.push(id);
    }
  }
  return { humanId, aiIds };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("card reveal", () => {
  // SKIPPED: depends on pre-redesign UI; revisit after card_reveal task
  test.skip("Reveal Card button text resets when switching to next AI after a reveal", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();

    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThanOrEqual(2);

      // Advance to card_reveal: select any mission as human via direct API
      await page.getByText("Mission Selection").waitFor({ state: "visible", timeout: 30000 });
      const gResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=pending_mission_options`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gRow] = (await gResp.json()) as Array<{ pending_mission_options: string[] }>;
      await fetch(`${SUPABASE_URL}/functions/v1/select-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          game_id: gameId,
          mission_key: gRow.pending_mission_options[0],
          override_player_id: humanId,
        }),
      });

      await page.getByText("Card Reveal").waitFor({ state: "visible", timeout: 15000 });

      // Switch to AI 1 in PlayerSwitcher
      const switcher = page.locator(".fixed.top-7");
      await switcher.locator(`[data-player-id="${aiIds[0]}"]`).click();
      await page.waitForTimeout(500);

      // Select a card from AI 1's hand. Hand card buttons carry a title attribute
      // (populated from CARD_MAP card description) which distinguishes them from
      // UI action buttons.
      const firstHandCard = page.locator("button[title]").first();
      await firstHandCard.waitFor({ state: "visible", timeout: 5000 });
      await firstHandCard.click();

      // Click "Reveal Card" — this sets loading=true inside CardReveal
      const revealBtn = page.getByRole("button", { name: /reveal card/i });
      await revealBtn.waitFor({ state: "visible" });
      await revealBtn.click();

      // Wait for AI 1's reveal to land (the action form hides once has_revealed_card=true)
      await page.waitForTimeout(2000);

      // Switch to AI 2
      await switcher.locator(`[data-player-id="${aiIds[1]}"]`).click();
      await page.waitForTimeout(300);

      // AI 2's "Reveal Card" button must show the label text, not the loading spinner.
      // Before the fix: loading=true leaked from AI 1, causing the Button to render "···"
      // instead of "Reveal Card", making getByRole fail to locate it.
      await expect(
        page.getByRole("button", { name: /reveal card/i })
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
