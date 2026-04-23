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

// Advances from mission_selection through card_reveal, stops at resource_allocation.
async function advanceThroughCardReveal(
  page: Page,
  gameId: string,
  token: string,
  aiIds: string[],
  humanId: string,
): Promise<void> {
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

  await page.getByText("Resource Allocation").waitFor({ state: "visible", timeout: 15000 });
}

// Zero-allocation path: advances all the way to player_turn without bumping any stats.
async function advanceToPlayerTurnNoBump(
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
  await page.getByText("Player Turn").waitFor({ state: "visible", timeout: 15000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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

      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const turnOrder = gameRow.turn_order_ids;

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

      await page.waitForTimeout(1000);

      if (!firstAiPlayedCard) {
        test.skip();
        return;
      }

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

  test("first player hand filled to new RAM after allocation bump", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();

    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();

      await advanceThroughCardReveal(page, gameId, token!, aiIds, humanId!);

      // Identify first player and their pre-allocation RAM
      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const firstPlayerId = gameRow.turn_order_ids[0];

      const p1Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${firstPlayerId}&select=ram`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [p1Row] = (await p1Resp.json()) as Array<{ ram: number }>;
      const ramBefore = p1Row.ram;

      // Allocate +2 RAM to first player and advance to player_turn
      await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          game_id: gameId,
          allocations: [{ player_id: firstPlayerId, cpu_delta: 0, ram_delta: 2 }],
          override_player_id: humanId,
        }),
      });

      await page.getByText("Player Turn").waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(500);

      // Verify post-allocation RAM and hand size both reflect the bump
      const p1AfterResp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${firstPlayerId}&select=ram`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [p1AfterRow] = (await p1AfterResp.json()) as Array<{ ram: number }>;
      expect(p1AfterRow.ram).toBe(ramBefore + 2);

      const handResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${firstPlayerId}&game_id=eq.${gameId}&select=id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand = (await handResp.json()) as Array<{ id: string }>;
      expect(hand.length).toBe(p1AfterRow.ram);
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  test("next player hand filled after virus-path turn advancement", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();

    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();

      await advanceThroughCardReveal(page, gameId, token!, aiIds, humanId!);

      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const firstPlayerId = gameRow.turn_order_ids[0];
      const secondPlayerId = gameRow.turn_order_ids[1];

      // Allocate +1 CPU to first AI so they have CPU=2 (triggers 1 virus per end-of-turn)
      await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          game_id: gameId,
          allocations: [{ player_id: firstPlayerId, cpu_delta: 1, ram_delta: 0 }],
          override_player_id: humanId,
        }),
      });

      await page.getByText("Player Turn").waitFor({ state: "visible", timeout: 15000 });

      // Find a progress card in the first player's hand to play
      const handResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${firstPlayerId}&game_id=eq.${gameId}&select=id,card_type`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand = (await handResp.json()) as Array<{ id: string; card_type: string }>;
      const progressCard = hand.find((c) => c.card_type === "progress");
      if (!progressCard) {
        test.skip();
        return;
      }

      // Play one card and end turn — CPU=2 with 1 card → 1 virus → virus_resolution
      await fetch(`${SUPABASE_URL}/functions/v1/play-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_id: progressCard.id, override_player_id: firstPlayerId }),
      });

      await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: firstPlayerId }),
      });
      await page.waitForTimeout(1000);

      // Fetch second player's RAM before they receive drawn cards
      const p2Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${secondPlayerId}&select=ram`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [p2Row] = (await p2Resp.json()) as Array<{ ram: number }>;
      const secondPlayerRam = p2Row.ram;

      // Resolve all queued virus cards by calling resolve-next-virus in a loop.
      // Stop when the game advances to player_turn (second player's turn).
      for (let i = 0; i < 10; i++) {
        const stateResp = await fetch(
          `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,current_turn_player_id`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        );
        const [stateRow] = (await stateResp.json()) as Array<{ phase: string; current_turn_player_id: string }>;
        if (stateRow.phase === "player_turn") break;
        if (stateRow.phase === "secret_targeting") {
          test.skip();
          return;
        }
        if (stateRow.phase !== "virus_resolution") break;

        await fetch(`${SUPABASE_URL}/functions/v1/resolve-next-virus`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game_id: gameId, override_player_id: firstPlayerId }),
        });
        await page.waitForTimeout(500);
      }

      // Confirm the game is now in player_turn with secondPlayer as active
      const finalStateResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,current_turn_player_id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [finalState] = (await finalStateResp.json()) as Array<{ phase: string; current_turn_player_id: string }>;

      if (finalState.phase !== "player_turn" || finalState.current_turn_player_id !== secondPlayerId) {
        // Mission completed or unexpected phase transition — skip rather than assert wrong target
        test.skip();
        return;
      }

      // advanceTurnOrPhase in resolve-next-virus should have drawn cards for secondPlayer
      const hand2Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${secondPlayerId}&game_id=eq.${gameId}&select=id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand2 = (await hand2Resp.json()) as Array<{ id: string }>;
      expect(hand2.length).toBe(secondPlayerRam);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
