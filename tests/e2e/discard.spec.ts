import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function dismissModal(page: Page): Promise<void> {
  const acknowledgeBtn = page.getByRole("button", { name: "Acknowledge" });
  if (await acknowledgeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await acknowledgeBtn.click();
    await page.waitForTimeout(200);
  }
}

async function advanceToPlayerTurn(
  page: Page,
  gameId: string,
  token: string,
  aiIds: string[],
  humanId: string,
): Promise<string> {
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
  await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
  });

  await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });

  const gameResp = await fetch(
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=current_turn_player_id`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const [gameRow] = (await gameResp.json()) as Array<{ current_turn_player_id: string }>;
  return gameRow.current_turn_player_id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("discard step", () => {
  // Test 1: discard 2 cards via REST — hand goes RAM → RAM-2 → RAM
  test("discarding 2 cards removes them then refills hand to RAM", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThan(0);

      const currentTurnId = await advanceToPlayerTurn(page, gameId, token!, aiIds, humanId!);
      expect(currentTurnId).toBeTruthy();

      // Read RAM and hand before discard
      const [p1Resp, hand1Resp] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/players?id=eq.${currentTurnId}&select=ram`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        ).then((r) => r.json() as Promise<Array<{ ram: number }>>),
        fetch(
          `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${currentTurnId}&game_id=eq.${gameId}&select=id`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        ).then((r) => r.json() as Promise<Array<{ id: string }>>),
      ]);
      const ram = p1Resp[0].ram;
      expect(hand1Resp.length).toBe(ram);
      if (hand1Resp.length < 2) { test.skip(); return; }

      const cardIds = [hand1Resp[0].id, hand1Resp[1].id];

      // Discard 2 cards
      const discardResp = await fetch(`${SUPABASE_URL}/functions/v1/discard-cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_ids: cardIds, override_player_id: currentTurnId }),
      });
      const discardResult = await discardResp.json() as Record<string, unknown>;
      expect(discardResult.error).toBeUndefined();
      expect(discardResult.cards_discarded).toBe(2);

      // Hand should be back to RAM (discard-then-draw refills to RAM)
      const hand2Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${currentTurnId}&game_id=eq.${gameId}&select=id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand2 = (await hand2Resp.json()) as Array<{ id: string }>;
      expect(hand2.length).toBe(ram);

      // has_discarded_this_turn should be true
      const playerResp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${currentTurnId}&select=has_discarded_this_turn`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [playerRow] = (await playerResp.json()) as Array<{ has_discarded_this_turn: boolean }>;
      expect(playerRow.has_discarded_this_turn).toBe(true);
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // Test 2: skip discard (empty array) — hand stays at RAM, has_discarded becomes true
  test("skipping discard leaves hand unchanged and sets has_discarded_this_turn", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();

      const currentTurnId = await advanceToPlayerTurn(page, gameId, token!, aiIds, humanId!);
      expect(currentTurnId).toBeTruthy();

      const p1Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${currentTurnId}&select=ram,has_discarded_this_turn`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [p1Row] = (await p1Resp.json()) as Array<{ ram: number; has_discarded_this_turn: boolean }>;
      expect(p1Row.has_discarded_this_turn).toBe(false);

      // Skip discard
      const discardResp = await fetch(`${SUPABASE_URL}/functions/v1/discard-cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_ids: [], override_player_id: currentTurnId }),
      });
      const discardResult = await discardResp.json() as Record<string, unknown>;
      expect(discardResult.error).toBeUndefined();
      expect(discardResult.cards_discarded).toBe(0);

      // Hand unchanged — still RAM
      const handResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${currentTurnId}&game_id=eq.${gameId}&select=id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand = (await handResp.json()) as Array<{ id: string }>;
      expect(hand.length).toBe(p1Row.ram);

      // has_discarded_this_turn should now be true
      const p2Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${currentTurnId}&select=has_discarded_this_turn`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [p2Row] = (await p2Resp.json()) as Array<{ has_discarded_this_turn: boolean }>;
      expect(p2Row.has_discarded_this_turn).toBe(true);
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // Test 4: turn advance resets has_discarded_this_turn for the next player
  test("turn advance resets has_discarded_this_turn for next player", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThan(1);

      const currentTurnId = await advanceToPlayerTurn(page, gameId, token!, aiIds, humanId!);
      expect(currentTurnId).toBeTruthy();

      // Identify the next player in turn order
      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const turnOrder = gameRow.turn_order_ids;
      const currentIdx = turnOrder.indexOf(currentTurnId);
      if (currentIdx < 0 || currentIdx >= turnOrder.length - 1) { test.skip(); return; }
      const nextPlayerId = turnOrder[currentIdx + 1];

      // Skip discard for current player → has_discarded_this_turn becomes true
      const skipResp = await fetch(`${SUPABASE_URL}/functions/v1/discard-cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_ids: [], override_player_id: currentTurnId }),
      });
      expect((await skipResp.json() as Record<string, unknown>).error).toBeUndefined();

      // End current player's turn (CPU=1, numViruses=0 → advanceTurnOrPhase runs)
      const endResp = await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: currentTurnId }),
      });
      expect((await endResp.json() as Record<string, unknown>).error).toBeUndefined();

      // Next player's has_discarded_this_turn must be false — the backend reset it
      const nextPlayerResp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${nextPlayerId}&select=has_discarded_this_turn,id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [nextPlayerRow] = (await nextPlayerResp.json()) as Array<{ has_discarded_this_turn: boolean; id: string }>;
      expect(nextPlayerRow.has_discarded_this_turn).toBe(false);

      // Game should have advanced to next player's turn
      const freshGameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=current_turn_player_id,phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [freshGame] = (await freshGameResp.json()) as Array<{ current_turn_player_id: string; phase: string }>;
      expect(freshGame.phase).toBe("player_turn");
      expect(freshGame.current_turn_player_id).toBe(nextPlayerId);
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // Test 3: play-card before discard → 400 "Must complete discard step"
  test("play-card is rejected with 400 when discard step not yet completed", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();

      const currentTurnId = await advanceToPlayerTurn(page, gameId, token!, aiIds, humanId!);
      expect(currentTurnId).toBeTruthy();

      // Find a progress card in hand (do NOT discard first)
      const handResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${currentTurnId}&game_id=eq.${gameId}&select=id,card_type`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand = (await handResp.json()) as Array<{ id: string; card_type: string }>;
      const progressCard = hand.find((c) => c.card_type === "progress");
      if (!progressCard) { test.skip(); return; }

      const playResp = await fetch(`${SUPABASE_URL}/functions/v1/play-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_id: progressCard.id, override_player_id: currentTurnId }),
      });
      expect(playResp.status).toBe(400);
      const playResult = await playResp.json() as Record<string, unknown>;
      expect(playResult.error).toBe("Must complete discard step before playing cards");
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
