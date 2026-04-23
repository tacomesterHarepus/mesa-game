import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Helpers (mirrors virus-system.spec.ts) ────────────────────────────────────

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

// Advances mission_selection → card_reveal → resource_allocation → player_turn.
// Allocates zero CPU/RAM so all AIs keep CPU=1 (no virus generation during draw test).
async function advanceToPlayerTurnNoBump(
  page: Page,
  gameId: string,
  token: string,
  aiIds: string[],
  humanId: string,
): Promise<void> {
  // Mission selection: switch to human and pick any mission
  await page.getByText("Mission Selection").waitFor({ state: "visible", timeout: 30000 });
  const switcherPanel = page.locator(".fixed.top-7");
  const playerButtons = switcherPanel.getByRole("button");
  const count = await playerButtons.count();
  for (let i = 0; i < count; i++) {
    await playerButtons.nth(i).click();
    await page.waitForTimeout(200);
    const label = await playerButtons.nth(i).textContent();
    if (label?.includes("H")) break;
  }
  await page.locator("button:not([name])").filter({ hasText: /Compute|Data|Validation/ }).first().click();
  await page.getByRole("button", { name: "Select Mission" }).click();

  // Card reveal: each AI reveals their first hand card via direct API
  await page.getByText("Card Reveal").waitFor({ state: "visible", timeout: 15000 });
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

  // Resource allocation: zero CPU/RAM deltas — advance phase without changing stats
  await page.getByText("Resource Allocation").waitFor({ state: "visible", timeout: 15000 });
  await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
  });

  await page.getByText("Player Turn").waitFor({ state: "visible", timeout: 15000 });
}

// ── Test ──────────────────────────────────────────────────────────────────────

test.describe("draw cards", () => {
  test("AI hand is replenished to RAM at the start of each new turn", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();

    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThan(0);

      await advanceToPlayerTurnNoBump(page, gameId, token!, aiIds, humanId!);

      // Fetch the actual turn order from the game row
      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const turnOrder = gameRow.turn_order_ids;

      // Fetch the first AI's RAM (starting value before any allocation)
      const firstPlayerId = turnOrder[0];
      const p1Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${firstPlayerId}&select=ram`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [p1Row] = (await p1Resp.json()) as Array<{ ram: number }>;
      const ram = p1Row.ram;

      // Round 1: each AI plays one progress card (if available) then ends their turn.
      // CPU=1 with ≤1 card played → virus count = 0 → no virus resolution phase.
      let firstAiPlayedCard = false;
      for (const playerId of turnOrder) {
        const handResp = await fetch(
          `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${playerId}&game_id=eq.${gameId}&select=id,card_type`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        );
        const hand = (await handResp.json()) as Array<{ id: string; card_type: string }>;
        const progressCard = hand.find((c) => c.card_type === "progress");

        if (progressCard) {
          await fetch(`${SUPABASE_URL}/functions/v1/play-card`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ game_id: gameId, card_id: progressCard.id, override_player_id: playerId }),
          });
          if (playerId === firstPlayerId) firstAiPlayedCard = true;
          await page.waitForTimeout(300);
        }

        await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
        });
        await page.waitForTimeout(600);
      }

      // Wait for round 2 to begin (advanceTurnOrPhase draws for the first AI before setting phase)
      await page.waitForTimeout(1000);

      if (!firstAiPlayedCard) {
        // First AI had no progress cards — draw amount was 0, test is vacuous. Skip.
        test.skip();
        return;
      }

      // The first AI played a card in round 1 (hand went from ram → ram-1).
      // advanceTurnOrPhase should have drawn 1 card when advancing to round 2,
      // restoring the hand to ram.
      const hand2Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${firstPlayerId}&game_id=eq.${gameId}&select=id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand2 = (await hand2Resp.json()) as Array<{ id: string }>;

      expect(hand2.length).toBe(ram);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
