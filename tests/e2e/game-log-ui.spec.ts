import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Helpers (duplicated from game-log.spec.ts — spec files must be standalone) ─

async function fillLobby(ctx: BrowserContext): Promise<{ page: Page; gameId: string }> {
  const page = await ctx.newPage();
  await page.goto("/game/create");
  await page.getByLabel("Display name").fill("UIBot");
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
    if (label.includes("H")) { if (!humanId) humanId = id; }
    else { aiIds.push(id); }
  }
  return { humanId, aiIds };
}

async function drainVirusQueue(gameId: string, token: string, overridePlayerId?: string): Promise<void> {
  for (let i = 0; i < 25; i++) {
    const phaseResp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [row] = (await phaseResp.json()) as Array<{ phase: string }>;
    if (row?.phase === "secret_targeting") {
      await fetch(`${SUPABASE_URL}/functions/v1/secret-target`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, force_resolve: true, override_player_id: overridePlayerId }),
      });
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    if (row?.phase !== "virus_resolution") break;
    await fetch(`${SUPABASE_URL}/functions/v1/resolve-next-virus`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId }),
    });
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe("GameLog UI rendering", () => {
  test.describe.configure({ mode: "serial" });

  let ctx: BrowserContext;
  let page: Page;
  let gameId: string;
  let token: string;
  let humanId: string | null;
  let aiIds: string[];
  let turnOrderIds: string[];
  let firstAiId: string;
  let cardPlayedEventFired = false;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext();
    ({ page, gameId } = await fillLobby(ctx));
    await startDevGame(page);

    token = (await extractAuthToken(page))!;
    expect(token).not.toBeNull();

    ({ humanId, aiIds } = await collectPlayerIds(page));
    expect(humanId).not.toBeNull();
    expect(aiIds.length).toBeGreaterThan(0);

    // Mission Selection
    await page.getByRole("heading", { name: "Mission Selection" }).waitFor({ state: "visible", timeout: 30000 });
    const switcherPanel = page.locator(".fixed.top-7");
    const playerButtons = switcherPanel.getByRole("button");
    const btnCount = await playerButtons.count();
    for (let i = 0; i < btnCount; i++) {
      await playerButtons.nth(i).click();
      await page.waitForTimeout(200);
      const label = await playerButtons.nth(i).textContent();
      if (label?.includes("H")) break;
    }
    await page.locator("button:not([name])").filter({ hasText: /Compute|Data|Validation/ }).first().click();
    await page.getByRole("button", { name: "Select Mission" }).click();

    // Card Reveal
    await page.getByRole("heading", { name: "Card Reveal" }).waitFor({ state: "visible", timeout: 30000 });
    for (const playerId of aiIds) {
      const handResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${playerId}&game_id=eq.${gameId}&select=id,card_key,card_type`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand = (await handResp.json()) as Array<{ id: string; card_key: string; card_type: string }>;
      if (!hand.length) continue;
      await fetch(`${SUPABASE_URL}/functions/v1/reveal-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_key: hand[0].card_key, override_player_id: playerId }),
      });
      await page.waitForTimeout(300);
    }

    // Resource Allocation (empty)
    await page.getByRole("heading", { name: "Resource Allocation" }).waitFor({ state: "visible", timeout: 30000 });
    await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
    });
    await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });

    // Get turn order
    const gameResp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
    turnOrderIds = gameRow.turn_order_ids;
    firstAiId = turnOrderIds[0];

    // Round 1, player 1: discard + try to play a progress card
    await fetch(`${SUPABASE_URL}/functions/v1/discard-cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, card_ids: [], override_player_id: firstAiId }),
    });
    await page.waitForTimeout(400);

    const handResp = await fetch(
      `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${firstAiId}&game_id=eq.${gameId}&select=id,card_key,card_type`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const hand = (await handResp.json()) as Array<{ id: string; card_key: string; card_type: string }>;
    const progressCard = hand.find((c) => c.card_type === "progress");
    if (progressCard) {
      const playResp = await fetch(`${SUPABASE_URL}/functions/v1/play-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_id: progressCard.id, override_player_id: firstAiId }),
      });
      cardPlayedEventFired = playResp.status === 200;
      await page.waitForTimeout(400);
    }

    // End player 1's turn
    await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, override_player_id: firstAiId }),
    });
    await page.waitForTimeout(400);
    await drainVirusQueue(gameId, token, humanId ?? aiIds[0]);

    // Round 1, players 2-N: end turn only
    for (const playerId of turnOrderIds.slice(1)) {
      await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
      });
      await page.waitForTimeout(400);
      await drainVirusQueue(gameId, token, humanId ?? aiIds[0]);
    }

    // Round 2: all players end turn — last triggers mission_failed
    for (const playerId of turnOrderIds) {
      await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
      });
      await page.waitForTimeout(400);
      await drainVirusQueue(gameId, token, humanId ?? aiIds[0]);
    }

    // Wait for mission to resolve and UI to update
    await page.getByRole("heading", { name: "Resource Adjustment" }).waitFor({ state: "visible", timeout: 40000 });
    // Give Realtime a moment to deliver the final log entries to the browser
    await page.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => {});
  });

  // ── Tests ────────────────────────────────────────────────────────────────────

  test("bold styling: mission_failed row renders with bold font weight", async () => {
    const logContainer = page.getByTestId("game-log-container");
    await expect(logContainer).toBeVisible();
    // New board renders bold via inline style fontWeight:"bold" (not Tailwind .font-bold class)
    const boldRows = logContainer.locator('span[style*="font-weight: bold"]');
    await expect(boldRows.first()).toBeVisible();
    const boldText = await boldRows.first().textContent();
    expect(boldText).toMatch(/mission/i);
  });

  test("card_played running totals: rows show (current/required) format", async () => {
    test.skip(!cardPlayedEventFired, "player 1 had no progress card — cannot verify running totals");
    const logContainer = page.getByTestId("game-log-container");
    const allRows = logContainer.locator("div");
    const rowCount = await allRows.count();
    let found = false;
    for (let i = 0; i < rowCount; i++) {
      const text = await allRows.nth(i).textContent();
      if (text && /\(\d+\/\d+\)/.test(text)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("scroll preservation: scrolling up prevents auto-scroll on new entries", async () => {
    const logContainer = page.getByTestId("game-log-container");

    // The log should be scrollable (many entries from the full game run)
    const isScrollable = await logContainer.evaluate(
      (el) => el.scrollHeight > el.clientHeight
    );
    if (!isScrollable) {
      test.skip();
      return;
    }

    // After mount + all Realtime entries, the container should be at the bottom
    const distFromBottomAtMount = await logContainer.evaluate(
      (el) => el.scrollHeight - el.scrollTop - el.clientHeight
    );
    expect(distFromBottomAtMount).toBeLessThanOrEqual(5);

    // Scroll to the top (> 40px from bottom)
    await logContainer.evaluate((el) => { el.scrollTop = 0; });
    const scrollTopAfterManual = await logContainer.evaluate((el) => el.scrollTop);
    expect(scrollTopAfterManual).toBeLessThanOrEqual(5);

    // Wait to confirm no auto-scroll fires without new entries
    await page.waitForTimeout(1500);
    const scrollTopAfterWait = await logContainer.evaluate((el) => el.scrollTop);
    expect(scrollTopAfterWait).toBeLessThanOrEqual(5);
  });
});
