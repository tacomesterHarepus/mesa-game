import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { devFetch } from "./_helpers";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Shared helpers (mirrored from abort-mission.spec.ts) ───────────────────────

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

// Returns ALL human IDs and all AI IDs from the DevModeOverlay switcher.
async function collectAllPlayerIds(page: Page): Promise<{ humanIds: string[]; aiIds: string[] }> {
  const switcherPanel = page.locator(".fixed.top-7");
  const allButtons = switcherPanel.locator("[data-player-id]");
  const count = await allButtons.count();
  const humanIds: string[] = [];
  const aiIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const btn = allButtons.nth(i);
    const label = await btn.textContent() ?? "";
    const id = await btn.getAttribute("data-player-id") ?? "";
    if (!id) continue;
    if (label.includes("H")) humanIds.push(id);
    else aiIds.push(id);
  }
  return { humanIds, aiIds };
}

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
    await devFetch(`${SUPABASE_URL}/functions/v1/reveal-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, card_key: hand[0].card_key, override_player_id: playerId }),
    });
    await page.waitForTimeout(300);
  }

  await page.getByRole("heading", { name: "Resource Allocation" }).waitFor({ state: "visible", timeout: 45000 });
  await devFetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
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

async function driveRound(
  page: Page,
  gameId: string,
  token: string,
  turnOrderIds: string[],
): Promise<void> {
  for (const playerId of turnOrderIds) {
    const resp = await devFetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
    });
    expect(resp.status).toBe(200);
    await page.waitForTimeout(400);
  }
}

// Flags abort as humanIds[0], then drives end-play-phase for turnOrderIds[0].
// Returns the game state immediately before the flag and the mission key.
// Pre-condition: game is at player_turn, round 2, current player = turnOrderIds[0]
// (and turnOrderIds has at least 2 entries so [0] is not the last turn).
async function flagAndDriveToAbortVote(
  gameId: string,
  token: string,
  humanId: string,
  firstAiId: string,
): Promise<void> {
  const flagResp = await devFetch(`${SUPABASE_URL}/functions/v1/flag-abort`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, override_player_id: humanId }),
  });
  expect(flagResp.status).toBe(200);

  const eplResp = await devFetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, override_player_id: firstAiId }),
  });
  expect(eplResp.status).toBe(200);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("abort-vote", () => {
  // (a) flag during round 2 non-last AI turn → end-play-phase opens abort_vote
  test("flag-abort during round 2 opens vote at end-play-phase boundary", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanIds, aiIds } = await collectAllPlayerIds(page);
      expect(humanIds.length).toBeGreaterThanOrEqual(2);
      expect(aiIds.length).toBeGreaterThanOrEqual(2);

      const { turnOrderIds } = await advanceToPlayerTurnRound1(page, gameId, token!, humanIds[0], aiIds);
      await driveRound(page, gameId, token!, turnOrderIds);

      // Verify we're at round 2, player_turn
      const r2Resp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=current_round,phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [r2State] = (await r2Resp.json()) as Array<{ current_round: number; phase: string }>;
      expect(r2State.current_round).toBe(2);
      expect(r2State.phase).toBe("player_turn");

      await flagAndDriveToAbortVote(gameId, token!, humanIds[0], turnOrderIds[0]);

      const finalResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [finalState] = (await finalResp.json()) as Array<{ phase: string }>;
      expect(finalState.phase).toBe("abort_vote");
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // (b) abort majority → resource_adjustment with penalty (NOT stuck at between_turns)
  test("abort majority transitions to resource_adjustment with penalty applied", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanIds, aiIds } = await collectAllPlayerIds(page);
      expect(humanIds.length).toBeGreaterThanOrEqual(2);

      const { turnOrderIds, missionId, escapeBefore } = await advanceToPlayerTurnRound1(
        page, gameId, token!, humanIds[0], aiIds
      );

      const missionResp = await fetch(
        `${SUPABASE_URL}/rest/v1/active_mission?id=eq.${missionId}&select=mission_key`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [{ mission_key }] = (await missionResp.json()) as Array<{ mission_key: string }>;
      const expectedPenalty = FAIL_PENALTIES[mission_key] ?? 1;

      await driveRound(page, gameId, token!, turnOrderIds);
      await flagAndDriveToAbortVote(gameId, token!, humanIds[0], turnOrderIds[0]);

      // Confirm abort_vote phase opened
      const phaseResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [phaseState] = (await phaseResp.json()) as Array<{ phase: string }>;
      expect(phaseState.phase).toBe("abort_vote");

      // Both humans vote abort
      for (const humanId of humanIds) {
        const voteResp = await devFetch(`${SUPABASE_URL}/functions/v1/submit-abort-vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game_id: gameId, vote: "abort", override_player_id: humanId }),
        });
        expect(voteResp.status).toBe(200);
      }

      // Server resolves synchronously on last vote; check final state
      const finalResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,escape_timer,current_mission_id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [finalState] = (await finalResp.json()) as Array<{
        phase: string;
        escape_timer: number;
        current_mission_id: string | null;
      }>;
      // Must resolve through to resource_adjustment — NOT stuck at between_turns
      expect(finalState.phase).toBe("resource_adjustment");
      expect(finalState.escape_timer).toBe(escapeBefore + expectedPenalty);
      expect(finalState.current_mission_id).toBeNull();
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // (c) split vote (1 abort + 1 continue) → no majority → continue → next player_turn
  test("abort minority continues to next AI player_turn", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanIds, aiIds } = await collectAllPlayerIds(page);
      expect(humanIds.length).toBeGreaterThanOrEqual(2);

      const { turnOrderIds } = await advanceToPlayerTurnRound1(page, gameId, token!, humanIds[0], aiIds);
      await driveRound(page, gameId, token!, turnOrderIds);
      await flagAndDriveToAbortVote(gameId, token!, humanIds[0], turnOrderIds[0]);

      // Split vote: one abort, one continue
      const vote1Resp = await devFetch(`${SUPABASE_URL}/functions/v1/submit-abort-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, vote: "abort", override_player_id: humanIds[0] }),
      });
      expect(vote1Resp.status).toBe(200);

      const vote2Resp = await devFetch(`${SUPABASE_URL}/functions/v1/submit-abort-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, vote: "continue", override_player_id: humanIds[1] }),
      });
      expect(vote2Resp.status).toBe(200);

      // No majority → continue → next AI's player_turn
      const finalResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,current_turn_player_id,current_mission_id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [finalState] = (await finalResp.json()) as Array<{
        phase: string;
        current_turn_player_id: string;
        current_mission_id: string | null;
      }>;
      expect(finalState.phase).toBe("player_turn");
      expect(finalState.current_turn_player_id).toBe(turnOrderIds[1]);
      expect(finalState.current_mission_id).not.toBeNull();
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // (d) flag-abort rejected on last turn of round 2; UI suppresses the button
  test("flag-abort rejected on last turn of round 2 and UI hides the button", async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      const { humanIds, aiIds } = await collectAllPlayerIds(page);
      expect(humanIds.length).toBeGreaterThanOrEqual(1);

      const { turnOrderIds } = await advanceToPlayerTurnRound1(page, gameId, token!, humanIds[0], aiIds);
      await driveRound(page, gameId, token!, turnOrderIds);

      // Advance round 2 through all but the last AI (no flag, so no abort_vote opens)
      for (let i = 0; i < turnOrderIds.length - 1; i++) {
        const resp = await devFetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game_id: gameId, override_player_id: turnOrderIds[i] }),
        });
        expect(resp.status).toBe(200);
        await page.waitForTimeout(400);
      }

      // Confirm we're on the last AI's turn in round 2
      const stateResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,current_round,current_turn_player_id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [state] = (await stateResp.json()) as Array<{
        phase: string; current_round: number; current_turn_player_id: string;
      }>;
      expect(state.phase).toBe("player_turn");
      expect(state.current_round).toBe(2);
      expect(state.current_turn_player_id).toBe(turnOrderIds[turnOrderIds.length - 1]);

      // Server rejects flag-abort on last turn
      const flagResp = await devFetch(`${SUPABASE_URL}/functions/v1/flag-abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: humanIds[0] }),
      });
      expect(flagResp.status).toBe(400);
      const flagResult = (await flagResp.json()) as Record<string, unknown>;
      expect(flagResult.error).toBe("Cannot flag abort on last turn of round 2");

      // UI: switch to human view and confirm FLAG ABORT button is not rendered
      const switcherPanel = page.locator(".fixed.top-7");
      const humanBtn = switcherPanel.locator(`[data-player-id="${humanIds[0]}"]`);
      await humanBtn.click();
      await dismissModal(page);
      await page.waitForTimeout(500);

      await expect(page.getByTestId("flag-abort-btn")).not.toBeVisible();
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
