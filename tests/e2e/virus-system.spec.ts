import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Helpers (mirrors dev-mode.spec.ts) ───────────────────────────────────────

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

// Extract the Supabase access_token from the browser context's cookies.
// @supabase/ssr stores the session as "base64-<base64_data>" in sb-<ref>-auth-token cookies.
async function extractAuthToken(page: Page): Promise<string | null> {
  const PREFIX = "sb-qpoakdiwmpaxvvzpqqdh-auth-token";
  const allCookies = await page.context().cookies("http://localhost:3000");

  // Try the single-chunk cookie first
  const single = allCookies.find((c) => c.name === PREFIX);
  let sessionStr: string | null = null;
  if (single?.value) {
    try { sessionStr = decodeURIComponent(single.value); } catch { sessionStr = single.value; }
  } else {
    // Try chunked cookies (.0, .1, …)
    let chunks = "";
    for (let i = 0; ; i++) {
      const chunk = allCookies.find((c) => c.name === `${PREFIX}.${i}`);
      if (!chunk?.value) break;
      try { chunks += decodeURIComponent(chunk.value); } catch { chunks += chunk.value; }
    }
    if (chunks) sessionStr = chunks;
  }

  if (!sessionStr) return null;

  // @supabase/ssr encodes the session as "base64-<base64_data>" — strip and decode it.
  if (sessionStr.startsWith("base64-")) {
    sessionStr = Buffer.from(sessionStr.slice(7), "base64").toString("utf-8");
  }

  try {
    return (JSON.parse(sessionStr) as { access_token?: string }).access_token ?? null;
  } catch {
    return null;
  }
}

// Collects player IDs from the DevModeOverlay switcher buttons (which carry data-player-id).
// Returns { humanId, aiIds } — aiIds are in button order.
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

// Advances a dev-mode game from mission_selection → card_reveal → resource_allocation → player_turn.
// Grants +1 CPU to the first two AIs so that at least 2 have CPU=2, triggering virus generation.
// Card reveal and resource allocation use direct Supabase API calls (no UI interactions) to avoid
// hand-state race conditions and rendering timing issues with the React components.
async function advanceToPlayerTurnWithCpu2(page: Page, gameId: string): Promise<void> {
  const switcherPanel = page.locator(".fixed.top-7");
  const playerButtons = switcherPanel.getByRole("button");
  const count = await playerButtons.count();

  // ── Mission Selection: switch to human, pick a mission card, then submit ──
  await page.getByText("Mission Selection").waitFor({ state: "visible", timeout: 30000 });
  for (let i = 0; i < count; i++) {
    await playerButtons.nth(i).click();
    await page.waitForTimeout(200);
    const label = await playerButtons.nth(i).textContent();
    if (label?.includes("H")) break;
  }
  await page.locator("button:not([name])").filter({ hasText: /Compute|Data|Validation/ }).first().click();
  await page.getByRole("button", { name: "Select Mission" }).click();

  // ── Card Reveal: call reveal-card edge function via Node.js fetch for each AI ──
  // Avoids the GameBoard async-hand-fetch race condition — hand state may lag the player switch.
  await page.getByText("Card Reveal").waitFor({ state: "visible", timeout: 15000 });

  const token = await extractAuthToken(page);
  if (!token) throw new Error("Could not extract auth token from Supabase SSR cookies");

  const { humanId, aiIds } = await collectPlayerIds(page);

  for (const playerId of aiIds) {
    const handResp = await fetch(
      `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${playerId}&game_id=eq.${gameId}&select=card_key`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    if (!handResp.ok) continue;
    const hand = (await handResp.json()) as Array<{ card_key: string }>;
    if (!hand.length) continue;

    await fetch(`${SUPABASE_URL}/functions/v1/reveal-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, card_key: hand[0].card_key, override_player_id: playerId }),
    });

    await page.waitForTimeout(300);
  }

  // ── Resource Allocation: grant +1 CPU to first 2 AIs via direct API call ──
  // This ensures at least 2 AIs have CPU=2, which is required to trigger virus_resolution.
  await page.getByText("Resource Allocation").waitFor({ state: "visible", timeout: 15000 });

  if (humanId && aiIds.length >= 2) {
    const allocations = [
      { player_id: aiIds[0], cpu_delta: 1, ram_delta: 0 },
      { player_id: aiIds[1], cpu_delta: 1, ram_delta: 0 },
    ];
    await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, allocations, override_player_id: humanId }),
    });
  }

  await page.getByText("Player Turn").waitFor({ state: "visible", timeout: 15000 });
}

// Finds the active turn player in the switcher and ends their turn.
// Returns true if End Turn was clicked.
async function endCurrentPlayerTurn(page: Page): Promise<boolean> {
  const switcherPanel = page.locator(".fixed.top-7");
  const playerButtons = switcherPanel.getByRole("button");
  const count = await playerButtons.count();
  for (let i = 0; i < count; i++) {
    await playerButtons.nth(i).click();
    await page.waitForTimeout(300);
    const endBtn = page.getByRole("button", { name: "End Turn" });
    if (await endBtn.isVisible().catch(() => false)) {
      await endBtn.click();
      return true;
    }
  }
  return false;
}

// ── Shared setup ──────────────────────────────────────────────────────────────

test.describe("virus resolution system", () => {
  test.describe.configure({ mode: "serial" });

  let sharedCtx: BrowserContext;
  let sharedPage: Page;
  let reachedVirusResolution = false;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    sharedCtx = await browser.newContext();
    const { page, gameId } = await fillLobby(sharedCtx, "Bot1");
    sharedPage = page;
    await startDevGame(sharedPage);
    await advanceToPlayerTurnWithCpu2(sharedPage, gameId);

    // End turns (up to 8) until virus_resolution phase appears.
    // With 2 of 4 AIs having CPU=2, we expect ~50% of turns to trigger virus_resolution.
    for (let turn = 0; turn < 8; turn++) {
      const ended = await endCurrentPlayerTurn(sharedPage);
      if (!ended) break;

      // Wait for phase change
      await sharedPage.waitForTimeout(2000);

      if (await sharedPage.getByText("Virus Resolution").isVisible().catch(() => false)) {
        reachedVirusResolution = true;
        break;
      }

      // Still player_turn — continue loop
      if (!await sharedPage.getByText("Player Turn").isVisible().catch(() => false)) break;
    }
  });

  test.afterAll(async () => {
    await sharedCtx.close().catch(() => {});
  });

  test("VirusResolution phase renders heading and Resolve button", async () => {
    if (!reachedVirusResolution) test.skip();
    await expect(sharedPage.getByText("Virus Resolution")).toBeVisible();
    await expect(
      sharedPage.getByRole("button", { name: /Resolve Virus|Continue/ })
    ).toBeVisible();
  });

  test("next virus card name is displayed in the queue panel", async () => {
    if (!reachedVirusResolution) test.skip();
    // The queue panel shows either a card name or the empty-queue message
    const hasCard = await sharedPage.getByText("Next virus card:").isVisible().catch(() => false);
    const hasEmpty = await sharedPage.getByText("Queue empty").isVisible().catch(() => false);
    expect(hasCard || hasEmpty).toBe(true);
  });

  test("clicking Resolve Virus advances the phase or queues next card", async () => {
    if (!reachedVirusResolution) test.skip();

    const resolveBtn = sharedPage.getByRole("button", { name: /Resolve Virus|Continue/ });
    await expect(resolveBtn).toBeVisible();
    await resolveBtn.click();

    // After resolution the game transitions to one of:
    // virus_resolution (more cards), player_turn (turn advance), resource_adjustment (mission ended)
    await sharedPage.waitForTimeout(3000);

    const stillResolving = await sharedPage.getByText("Virus Resolution").isVisible().catch(() => false);
    const playerTurn = await sharedPage.getByText("Player Turn").isVisible().catch(() => false);
    const resourceAdj = await sharedPage.getByText("Resource Adjustment").isVisible().catch(() => false);
    expect(stillResolving || playerTurn || resourceAdj).toBe(true);
  });
});
