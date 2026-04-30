import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

async function dismissModal(page: Page): Promise<void> {
  try {
    const btn = page.getByRole("button", { name: /Acknowledge/i });
    await btn.waitFor({ state: "visible", timeout: 4_000 });
    await btn.click();
    await btn.waitFor({ state: "hidden", timeout: 3_000 });
  } catch { /* no modal */ }
}

const FAIL_PENALTIES: Record<string, number> = {
  data_cleanup: 1, basic_model_training: 1,
  dataset_preparation: 1, cross_validation: 1, distributed_training: 1,
  balanced_compute_cluster: 2, dataset_integration: 2, multi_model_ensemble: 2,
  synchronized_training: 2, genome_simulation: 2,
  global_research_network: 3, experimental_vaccine_model: 3,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  } catch { return null; }
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

// Advances through mission_selection → card_reveal → resource_allocation → player_turn.
// Returns { turnOrderIds, missionId, escapeBefore }.
async function advanceToPlayerTurnRound1(
  page: Page,
  gameId: string,
  token: string,
  humanId: string,
  aiIds: string[],
): Promise<{ turnOrderIds: string[]; missionId: string; escapeBefore: number }> {
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

  await page.getByRole("heading", { name: "Resource Allocation" }).waitFor({ state: "visible", timeout: 45000 });
  await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
  });

  await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });

  const gameResp = await fetch(
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids,current_mission_id,escape_timer`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const [row] = (await gameResp.json()) as Array<{
    turn_order_ids: string[];
    current_mission_id: string;
    escape_timer: number;
  }>;
  return { turnOrderIds: row.turn_order_ids, missionId: row.current_mission_id, escapeBefore: row.escape_timer };
}

// Drives all AIs through one round by calling end-play-phase for each in order.
// CPU=1, 0 cards played → 0 viruses → direct turn advance (no virus_resolution).
async function driveRound(
  page: Page,
  gameId: string,
  token: string,
  turnOrderIds: string[],
): Promise<void> {
  for (const playerId of turnOrderIds) {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
    });
    expect(resp.status).toBe(200);
    await page.waitForTimeout(400);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("abort-mission", () => {
  // Test 1: abort applies fail penalty and moves to resource_adjustment
  test("abort fires in round 2 and transitions to resource_adjustment", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThan(0);

      const { turnOrderIds, missionId, escapeBefore } = await advanceToPlayerTurnRound1(
        page, gameId, token!, humanId!, aiIds
      );

      // Look up mission key to determine the expected penalty
      const missionResp = await fetch(
        `${SUPABASE_URL}/rest/v1/active_mission?id=eq.${missionId}&select=mission_key`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [{ mission_key }] = (await missionResp.json()) as Array<{ mission_key: string }>;
      const expectedPenalty = FAIL_PENALTIES[mission_key] ?? 1;

      // Drive round 1 — after last player, game moves to round 2
      await driveRound(page, gameId, token!, turnOrderIds);

      const round2Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=current_round,phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [round2State] = (await round2Resp.json()) as Array<{ current_round: number; phase: string }>;
      expect(round2State.current_round).toBe(2);
      expect(round2State.phase).toBe("player_turn");

      // Call abort-mission as human
      const abortResp = await fetch(`${SUPABASE_URL}/functions/v1/abort-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: humanId }),
      });
      expect(abortResp.status).toBe(200);
      const abortResult = (await abortResp.json()) as Record<string, unknown>;
      expect(abortResult.error).toBeUndefined();

      // Game should now be in resource_adjustment with penalty applied and mission cleared
      const finalResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,escape_timer,current_mission_id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [finalState] = (await finalResp.json()) as Array<{
        phase: string;
        escape_timer: number;
        current_mission_id: string | null;
      }>;
      expect(finalState.phase).toBe("resource_adjustment");
      expect(finalState.escape_timer).toBe(escapeBefore + expectedPenalty);
      expect(finalState.current_mission_id).toBeNull();
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // Test 2: abort is rejected in round 1
  test("abort is rejected with 400 when called in round 1", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();

      await advanceToPlayerTurnRound1(page, gameId, token!, humanId!, aiIds);

      // Attempt abort in round 1 — must fail
      const abortResp = await fetch(`${SUPABASE_URL}/functions/v1/abort-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: humanId }),
      });
      expect(abortResp.status).toBe(400);
      const result = (await abortResp.json()) as Record<string, unknown>;
      expect(result.error).toBe("Abort only valid in round 2");
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // Test 3: abort is rejected when called by an AI
  test("abort is rejected with 400 when called by an AI player", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThan(0);

      const { turnOrderIds } = await advanceToPlayerTurnRound1(page, gameId, token!, humanId!, aiIds);

      // Drive round 1 to reach round 2
      await driveRound(page, gameId, token!, turnOrderIds);

      // Attempt abort as the first AI — must fail
      const abortResp = await fetch(`${SUPABASE_URL}/functions/v1/abort-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: turnOrderIds[0] }),
      });
      expect(abortResp.status).toBe(400);
      const result = (await abortResp.json()) as Record<string, unknown>;
      expect(result.error).toBe("Only humans can abort the mission");
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
