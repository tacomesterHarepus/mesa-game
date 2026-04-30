import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function dismissModal(page: Page): Promise<void> {
  try {
    const btn = page.getByRole("button", { name: /Acknowledge/i });
    await btn.waitFor({ state: "visible", timeout: 4_000 });
    await btn.click();
    await btn.waitFor({ state: "hidden", timeout: 3_000 });
  } catch { /* no modal */ }
}

async function fillLobby(ctx: BrowserContext): Promise<{ page: Page; gameId: string }> {
  const page = await ctx.newPage();
  await page.goto("/game/create");
  await page.getByLabel("Display name").fill("Bot1");
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

async function advanceThroughCardReveal(
  page: Page,
  gameId: string,
  token: string,
  aiIds: string[],
  humanId: string,
): Promise<void> {
  await page.getByRole("heading", { name: "Mission Selection" }).waitFor({ state: "visible", timeout: 30000 });
  const switcherPanel = page.locator(".fixed.top-7");
  const playerButtons = switcherPanel.getByRole("button");
  const count = await playerButtons.count();
  for (let i = 0; i < count; i++) {
    await playerButtons.nth(i).click();
    await page.waitForTimeout(200);
    const label = await playerButtons.nth(i).textContent();
    if (label?.includes("H")) break;
  }
  await dismissModal(page);
  await page.locator("button:not([name])").filter({ hasText: /Compute|Data|Validation/ }).first().click();
  await page.getByRole("button", { name: "Select Mission" }).click();

  await page.getByRole("heading", { name: "Card Reveal" }).waitFor({ state: "visible", timeout: 15000 });
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

  await page.getByRole("heading", { name: "Resource Allocation" }).waitFor({ state: "visible", timeout: 15000 });
}

async function advanceToPlayerTurn(
  page: Page,
  gameId: string,
  token: string,
  aiIds: string[],
  humanId: string,
): Promise<void> {
  await advanceThroughCardReveal(page, gameId, token, aiIds, humanId);
  await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
  });
  await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("turn order", () => {
  // Verifies two properties introduced in Phase 10.5:
  //
  // Change 2 (start-game v8): games.turn_order_ids equals seat order on mission 1.
  //   Seat order = players sorted by players.turn_order ascending.
  //   Before the fix, start-game used two independent shuffles, making these inconsistent.
  //
  // Change 3 (advanceTurnOrPhase rotation): after a mission resolves, turn_order_ids
  //   becomes a cyclic rotation of seat order starting from the last-acting player.
  //   The test drives all AI turns through both rounds with no cards played, causing
  //   the mission to fail at the end of round 2. The last-acting player (turn_order_ids[last])
  //   must become turn_order_ids[0] in the next mission.
  test("initial turn order matches seat order; rotates to last-acting player after mission", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();

    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThanOrEqual(2);

      await advanceToPlayerTurn(page, gameId, token!, aiIds, humanId!);

      // Read initial turn order set by start-game
      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const initialTurnOrder = gameRow.turn_order_ids;
      expect(initialTurnOrder.length).toBeGreaterThanOrEqual(2);

      // Read seat order: AI players sorted by players.turn_order ascending
      const playersResp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?game_id=eq.${gameId}&role=neq.human&select=id,turn_order&order=turn_order.asc`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const aiPlayersSorted = (await playersResp.json()) as Array<{ id: string; turn_order: number }>;
      const seatOrder = aiPlayersSorted.map((p) => p.id);

      // Change 2 assertion: mission 1 turn order equals seat order (no double shuffle)
      expect(initialTurnOrder).toEqual(seatOrder);

      // Drive all AI turns through round 1 and round 2 with no cards played.
      // CPU=1 → virusCount(1, 0) = 0 → end-play-phase goes straight to advanceTurnOrPhase.
      // After the last player in round 2, mission fails → advanceTurnOrPhase rotates turn_order_ids.
      const allTurns = [...initialTurnOrder, ...initialTurnOrder]; // round 1 then round 2
      for (const playerId of allTurns) {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
        });
        expect(resp.status).toBe(200);
        await page.waitForTimeout(400);
      }

      // Wait for game to reach resource_adjustment
      await page.getByRole("heading", { name: "Resource Adjustment" }).waitFor({ state: "visible", timeout: 20000 });

      // Read new turn_order_ids
      const newGameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids,phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [newGameRow] = (await newGameResp.json()) as Array<{ turn_order_ids: string[]; phase: string }>;

      expect(newGameRow.phase).toBe("resource_adjustment");

      // Change 3 assertion 1: last-acting player (round 2 final) is now first
      const lastPlayer = initialTurnOrder[initialTurnOrder.length - 1];
      expect(newGameRow.turn_order_ids[0]).toBe(lastPlayer);

      // Change 3 assertion 2: full array is a cyclic rotation of seat order (not a re-shuffle)
      const lastIdx = seatOrder.indexOf(lastPlayer);
      const expectedRotation = [...seatOrder.slice(lastIdx), ...seatOrder.slice(0, lastIdx)];
      expect(newGameRow.turn_order_ids).toEqual(expectedRotation);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
