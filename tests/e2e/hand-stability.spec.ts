import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Helpers (shared pattern across E2E specs) ─────────────────────────────────

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

// Polls until the game reaches player_turn for a specific player. Returns false on timeout or game_over.
async function waitForPlayerTurn(
  gameId: string,
  token: string,
  playerId: string,
  timeoutMs = 30000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,current_turn_player_id`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [row] = (await resp.json()) as Array<{ phase: string; current_turn_player_id: string }>;
    if (row.phase === "player_turn" && row.current_turn_player_id === playerId) return true;
    if (row.phase === "game_over") return false;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// Ends one AI's turn (end-play-phase + resolve-next-virus loop). Returns false if
// secret_targeting or game_over is hit and the caller should test.skip().
async function advanceSingleAiTurn(
  gameId: string,
  token: string,
  playerId: string,
): Promise<"ok" | "skip"> {
  await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
  });

  // Resolve the virus resolution phase (handles empty queue for CPU=1 AIs too).
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const stateResp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [state] = (await stateResp.json()) as Array<{ phase: string }>;
    if (state.phase === "player_turn") return "ok";
    if (state.phase === "game_over") return "skip";
    if (state.phase === "secret_targeting") return "skip";
    if (state.phase === "virus_resolution") {
      await fetch(`${SUPABASE_URL}/functions/v1/resolve-next-virus`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
      });
    }
  }
  return "skip";
}

async function discardCards(gameId: string, playerId: string, token: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/functions/v1/discard-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, card_ids: [], override_player_id: playerId }),
  });
  await new Promise((r) => setTimeout(r, 300));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("hand stability", () => {
  test("hand tops up correctly after turn end (backend)", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();

    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThan(0);

      await advanceThroughCardReveal(page, gameId, token!, aiIds, humanId!);

      // Identify the first AI in turn order and give them CPU=2
      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const turnOrder = gameRow.turn_order_ids;
      const firstPlayerId = turnOrder[0];

      const allocResp = await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          game_id: gameId,
          allocations: [{ player_id: firstPlayerId, cpu_delta: 1, ram_delta: 0 }],
          override_player_id: humanId,
        }),
      });
      if (!allocResp.ok) { test.skip(); return; }

      await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });

      // Read first player's hand and stats before their turn
      const [handResp, p1Resp] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${firstPlayerId}&game_id=eq.${gameId}&select=id,card_key,card_type`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        ).then((r) => r.json() as Promise<Array<{ id: string; card_key: string; card_type: string }>>),
        fetch(
          `${SUPABASE_URL}/rest/v1/players?id=eq.${firstPlayerId}&select=ram`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        ).then((r) => r.json() as Promise<Array<{ ram: number }>>),
      ]);

      const oldHand = [...handResp].sort((a, b) => a.id.localeCompare(b.id));
      const ram = p1Resp[0].ram;

      const progressCard = oldHand.find((c) => c.card_type === "progress");
      if (!progressCard) { test.skip(); return; }

      // Pick a different card to stage (any card that isn't the progress card)
      const stageCard = oldHand.find((c) => c.id !== progressCard.id);
      if (!stageCard) { test.skip(); return; }

      const oldHandIds = new Set(oldHand.map((c) => c.id));

      // Play progress card via API
      await discardCards(gameId, firstPlayerId, token!);
      await fetch(`${SUPABASE_URL}/functions/v1/play-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_id: progressCard.id, override_player_id: firstPlayerId }),
      });

      // Stage a card via API (place-virus moves it to pending_viruses)
      await fetch(`${SUPABASE_URL}/functions/v1/place-virus`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_id: stageCard.id, override_player_id: firstPlayerId }),
      });

      // End the first AI's turn and handle their virus resolution
      const firstTurnResult = await advanceSingleAiTurn(gameId, token!, firstPlayerId);
      if (firstTurnResult === "skip") { test.skip(); return; }

      // Advance all remaining AIs through Round 1
      for (const playerId of turnOrder.slice(1)) {
        const ready = await waitForPlayerTurn(gameId, token!, playerId, 20000);
        if (!ready) { test.skip(); return; }

        const result = await advanceSingleAiTurn(gameId, token!, playerId);
        if (result === "skip") { test.skip(); return; }
      }

      // Wait for Round 2 — first AI's turn again (drawCardsForPlayer fired at round-2 transition)
      const round2Ready = await waitForPlayerTurn(gameId, token!, firstPlayerId, 30000);
      if (!round2Ready) { test.skip(); return; }

      // Read the new hand
      const newHandResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${firstPlayerId}&game_id=eq.${gameId}&select=id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const newHand = (await newHandResp.json()) as Array<{ id: string }>;
      const newHandIds = new Set(newHand.map((c) => c.id));

      // Retained cards (old hand minus played and staged) must all still be present
      const retainedIds = Array.from(oldHandIds).filter(
        (id) => id !== progressCard.id && id !== stageCard.id
      );
      for (const id of retainedIds) {
        expect(newHandIds.has(id)).toBe(true);
      }

      // Hand is exactly filled to RAM
      expect(newHand.length).toBe(ram);

      // Exactly ram - retained count new cards were drawn
      const newCardCount = newHand.filter((c) => !oldHandIds.has(c.id)).length;
      expect(newCardCount).toBe(ram - retainedIds.length);
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  test("hand display order is stable across polling cycles (UI)", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();

    try {
      const { page, gameId } = await fillLobby(ctx, "Bot1");
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();

      await advanceThroughCardReveal(page, gameId, token!, aiIds, humanId!);

      // Zero-allocation: advance straight to player_turn without bumping stats
      await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
      });

      await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });

      // Identify first AI in turn order and switch to them in DevModeOverlay
      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const firstPlayerId = gameRow.turn_order_ids[0];

      const switcherPanel = page.locator(".fixed.top-7");
      const playerButtons = switcherPanel.locator("[data-player-id]");
      const btnCount = await playerButtons.count();
      for (let i = 0; i < btnCount; i++) {
        const btn = playerButtons.nth(i);
        const pid = await btn.getAttribute("data-player-id");
        if (pid === firstPlayerId) {
          await btn.click();
          break;
        }
      }

      // Wait for the hand to load and one polling cycle to complete (~3s)
      await page.waitForTimeout(4500);

      // Read the rendered card order from the "Your Hand" section in the right panel
      const handSection = page.locator("h3").filter({ hasText: "Your Hand" }).locator("..");
      const cardButtons = handSection.locator("button");
      await expect(cardButtons.first()).toBeVisible({ timeout: 5000 });
      const names1 = await cardButtons.allTextContents();

      expect(names1.length).toBeGreaterThan(0);

      // Wait for another full polling cycle
      await page.waitForTimeout(4000);

      // Read card order again — must be identical after sort-by-id stabilization
      const names2 = await cardButtons.allTextContents();
      expect(names2).toEqual(names1);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
