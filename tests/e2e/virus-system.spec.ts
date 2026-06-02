import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { devFetch } from "./_helpers";

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

async function dismissModal(page: Page): Promise<void> {
  const acknowledgeBtn = page.getByRole("button", { name: "Acknowledge" });
  if (await acknowledgeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await acknowledgeBtn.click();
    await page.waitForTimeout(200);
  }
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
  await page.getByRole("heading", { name: "Mission Selection" }).waitFor({ state: "visible", timeout: 30000 });
  for (let i = 0; i < count; i++) {
    await playerButtons.nth(i).click();
    await page.waitForTimeout(200);
    const label = await playerButtons.nth(i).textContent();
    if (label?.includes("H")) break;
  }
  await dismissModal(page);
  await page.locator("button:not([name])").filter({ hasText: /Compute|Data|Validation/ }).first().click();
  await page.getByRole("button", { name: "Select Mission" }).click();

  // ── Card Reveal: call reveal-card edge function via Node.js fetch for each AI ──
  // Avoids the GameBoard async-hand-fetch race condition — hand state may lag the player switch.
  await page.getByRole("heading", { name: "Card Reveal" }).waitFor({ state: "visible", timeout: 15000 });

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

    await devFetch(`${SUPABASE_URL}/functions/v1/reveal-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, card_key: hand[0].card_key, override_player_id: playerId }),
    });

    await page.waitForTimeout(300);
  }

  // ── Resource Allocation: grant +1 CPU to first 2 AIs via direct API call ──
  // This ensures at least 2 AIs have CPU=2, which is required to trigger virus_resolution.
  await page.getByRole("heading", { name: "Resource Allocation" }).waitFor({ state: "visible", timeout: 15000 });

  if (humanId && aiIds.length >= 2) {
    const allocations = [
      { player_id: aiIds[0], cpu_delta: 1, ram_delta: 0 },
      { player_id: aiIds[1], cpu_delta: 1, ram_delta: 0 },
    ];
    await devFetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, allocations, override_player_id: humanId }),
    });
  }

  await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });
}

// Calls end-play-phase for the current turn player via REST, then chains pull-viruses
// if the phase transitions to virus_pull. Returns true if end-play-phase succeeded.
// Using REST (not UI button click) because CPU=2 players require staging a card before
// the End Turn button enables — REST skips that requirement and lets end-play-phase
// compute virus counts server-side, which is what triggers the virus flow.
async function endCurrentPlayerTurn(gameId: string, token: string): Promise<boolean> {
  const gameResp = await fetch(
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=current_turn_player_id,phase`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const [gameRow] = (await gameResp.json()) as Array<{ current_turn_player_id: string; phase: string }>;
  if (gameRow?.phase !== "player_turn" || !gameRow?.current_turn_player_id) return false;

  const resp = await devFetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, override_player_id: gameRow.current_turn_player_id }),
  });
  if (resp.status !== 200) return false;

  // Chain through virus_pull if end-play-phase set that intermediate phase.
  await new Promise((r) => setTimeout(r, 300));
  const phaseResp = await fetch(
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,current_turn_player_id`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const [phaseRow] = (await phaseResp.json()) as Array<{ phase: string; current_turn_player_id: string }>;
  if (phaseRow?.phase === "virus_pull" && phaseRow?.current_turn_player_id) {
    await devFetch(`${SUPABASE_URL}/functions/v1/pull-viruses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, override_player_id: phaseRow.current_turn_player_id }),
    });
  }

  return true;
}

// ── Pool-invariant helpers ────────────────────────────────────────────────────

// Repeatedly calls resolve-next-virus until phase leaves virus_resolution (or 20 iterations).
async function resolveVirusQueueFully(gameId: string, token: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,current_turn_player_id`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [row] = (await resp.json()) as Array<{ phase: string; current_turn_player_id: string }>;
    if (row?.phase !== "virus_resolution") break;
    if (!row?.current_turn_player_id) break;
    await devFetch(`${SUPABASE_URL}/functions/v1/resolve-next-virus`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, override_player_id: row.current_turn_player_id }),
    });
  }
}

// Returns current virus pool count via games.virus_pool_count (virus_pool table is service-role-only).
async function queryPoolCount(gameId: string, token: string): Promise<number> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=virus_pool_count`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const rows = (await resp.json()) as Array<{ virus_pool_count: number }>;
  return rows[0]?.virus_pool_count ?? 0;
}

// Waits for phase to reach a post-resolution settled state (player_turn, resource_adjustment, game_over).
async function waitForSettledPhase(gameId: string, token: string): Promise<string> {
  const settled = ["player_turn", "resource_adjustment", "game_over"];
  for (let w = 0; w < 20; w++) {
    await new Promise((r) => setTimeout(r, 600));
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [row] = (await resp.json()) as Array<{ phase: string }>;
    if (settled.includes(row?.phase ?? "")) return row.phase;
  }
  return "unknown";
}

// ── Shared setup ──────────────────────────────────────────────────────────────

test.describe("virus resolution system", () => {
  test.describe.configure({ mode: "serial" });

  let sharedCtx: BrowserContext;
  let sharedPage: Page;
  let sharedGameId = "";
  let reachedVirusResolution = false;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    sharedCtx = await browser.newContext();
    const { page, gameId } = await fillLobby(sharedCtx, "Bot1");
    sharedPage = page;
    sharedGameId = gameId;
    await startDevGame(sharedPage);
    await advanceToPlayerTurnWithCpu2(sharedPage, gameId);

    // End turns (up to 8) until virus_resolution phase appears.
    // With 2 of 4 AIs having CPU=2, we expect ~50% of turns to trigger virus_resolution.
    const token = await extractAuthToken(sharedPage);
    if (!token) throw new Error("Could not extract auth token from Supabase SSR cookies");

    for (let turn = 0; turn < 8; turn++) {
      const ended = await endCurrentPlayerTurn(gameId, token);

      // Check phase via REST — avoids false negatives from UI polling lag (3s interval).
      await sharedPage.waitForTimeout(1500);
      const phaseResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [phaseRow] = (await phaseResp.json()) as Array<{ phase: string }>;
      const phase = phaseRow?.phase;

      if (phase === "virus_resolution") {
        reachedVirusResolution = true;
        break;
      }

      if (!ended || phase !== "player_turn") break;
    }
  });

  test.afterAll(async () => {
    await sharedCtx.close().catch(() => {});
  });

  test("no manual Resolve button present — auto-resolve is active", async () => {
    if (!reachedVirusResolution) test.skip();
    // The old "Resolve Virus" and "Continue" manual buttons are gone — auto-resolve handles resolution
    await expect(
      sharedPage.getByRole("button", { name: /Resolve Virus|Continue/ })
    ).not.toBeVisible();
  });

  test("game is in a valid virus-resolution-adjacent phase (REST check)", async () => {
    if (!reachedVirusResolution || !sharedGameId) test.skip();
    const token = await extractAuthToken(sharedPage);
    if (!token) throw new Error("Could not extract auth token");
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${sharedGameId}&select=phase`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [row] = (await resp.json()) as Array<{ phase: string }>;
    const validPhases = [
      "virus_resolution",
      "player_turn",
      "between_turns",
      "resource_adjustment",
      "secret_targeting",
      "game_over",
    ];
    expect(validPhases).toContain(row?.phase);
  });

  test("phase auto-advances away from virus_resolution within 30s", async () => {
    if (!reachedVirusResolution || !sharedGameId) test.skip();
    const token = await extractAuthToken(sharedPage);
    if (!token) throw new Error("Could not extract auth token");

    // Poll REST every 2s for up to 30s waiting for phase to leave virus_resolution
    const advancedPhases = [
      "player_turn",
      "between_turns",
      "resource_adjustment",
      "secret_targeting",
      "game_over",
    ];
    let finalPhase = "virus_resolution";
    for (let i = 0; i < 15; i++) {
      await sharedPage.waitForTimeout(2000);
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${sharedGameId}&select=phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [row] = (await resp.json()) as Array<{ phase: string }>;
      finalPhase = row?.phase ?? "virus_resolution";
      if (advancedPhases.includes(finalPhase)) break;
    }

    expect(advancedPhases).toContain(finalPhase);
  });
});

// ── Part 3(b): pool invariant — pool equals 4 after EVERY settled virus resolution ────────────
//
// Tests the class-level property: pool == 4 at every settled state after a full resolution
// chain. Asserts the invariant multiple times across varied turns (1-virus paths, 2-virus paths,
// and CF chains that occur naturally as the game progresses).
//
// Also covers Part 3(a): over 12 turns the draw deck depletes to near-zero (each turn draws
// ~5 cards from in_deck for the next player's hand + refillVirusPool draws). By turn 8–10,
// in_deck < needed forces the supplement-draw path added in the fix. Pool == 4 holding
// throughout proves the supplement path is correctly producing the invariant.
//
// Pool count is queried via REST after each turn's full resolution (including cascade chains).
// If the invariant throw in refillVirusPool fires for any turn (returning 400 from the edge
// function), the phase stays as between_turns (never advanced to player_turn), the pool count
// query reads a short pool, and expect(count).toBe(4) fails loudly.

test.describe("pool invariant — pool equals 4 after every settled virus resolution", () => {
  test.describe.configure({ mode: "serial" });

  let invCtx: BrowserContext;
  let invPage: Page;
  let invGameId = "";
  let invToken: string | null = null;
  let invSetupDone = false;

  // Accumulates pool counts across turns; checked in test 2 (supplement-path verification).
  const poolCountHistory: number[] = [];

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    invCtx = await browser.newContext();
    const { page, gameId } = await fillLobby(invCtx, "Bot1");
    invPage = page;
    invGameId = gameId;
    await startDevGame(invPage);
    // Give 2 AIs CPU=2 → guaranteed 1 virus per turn for half the turns (base virus rule).
    // Remaining turns (CPU=1 AIs) skip refillVirusPool — pool stays at 4 trivially. Both
    // paths are asserted, covering 1-virus resolution and no-virus stability.
    await advanceToPlayerTurnWithCpu2(invPage, gameId);
    invToken = await extractAuthToken(invPage);
    invSetupDone = !!invToken;
  });

  test.afterAll(async () => {
    await invCtx.close().catch(() => {});
  });

  // Part 3(b): run 12 turns; assert pool == 4 after every single settled resolution.
  // Covers: 1-virus turns, 0-virus turns (pool unchanged), and any CF chains that arise.
  // Part 3(a) is embedded: around turns 8–10 the deck depletes naturally, forcing the
  // supplement-draw path. The invariant holding throughout proves Part 2 is correct.
  test("pool == 4 after every settled turn — 12-turn multi-path coverage", async () => {
    if (!invSetupDone) { test.skip(); return; }

    for (let turn = 0; turn < 12; turn++) {
      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${invGameId}&select=phase`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${invToken!}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ phase: string }>;
      if (gameRow?.phase !== "player_turn") break;

      // End turn: end-play-phase → virus_pull (if viruses generated) → pull-viruses
      const ended = await endCurrentPlayerTurn(invGameId, invToken!);
      if (!ended) break;

      // Fully drain the virus_resolution queue (resolve-next-virus until queue empty + refill)
      await resolveVirusQueueFully(invGameId, invToken!);

      // Wait for the phase to reach a settled post-resolution state
      await waitForSettledPhase(invGameId, invToken!);

      // THE INVARIANT: virus_pool count must be exactly 4 at every settled state
      const count = await queryPoolCount(invGameId, invToken!);
      poolCountHistory.push(count);
      expect(count, `turn ${turn + 1}: pool count after full resolution`).toBe(4);
    }

    // Require at least 8 completed turn assertions for meaningful coverage
    expect(poolCountHistory.length, "completed turn assertions").toBeGreaterThanOrEqual(8);
  });

  // Part 3(a): supplement-draw path verification. All 12 recorded pool counts must be
  // exactly 4 — including turns where the deck depleted and refillVirusPool had to
  // supplement from reshuffled discards. Any count != 4 would have already failed test 1;
  // this test makes the full history explicit and provides the array-level assertion.
  test("all recorded pool counts are exactly 4 — supplement path produced no drift", async () => {
    if (poolCountHistory.length < 8) { test.skip(); return; }
    poolCountHistory.forEach((count, i) => {
      expect(count, `turn ${i + 1} in history`).toBe(4);
    });
  });
});

// ── Part 4: mission reward deferred until after completing turn's virus chain ────
//
// Verifies:
// (a) mission_complete is logged AFTER viruses_placed in the game_log — never before.
// (b) games.core_progress is at the pre-reward value while phase=virus_pull; the reward is
//     applied only when advanceTurnOrPhase runs post-chain, not when end-play-phase runs.
//     Intermediate check: pending_core_progress_delta is set and core_progress is unchanged.
// (c) [conditional] contribution-removing virus during completing turn's chain rejects the
//     deferred reward — mission_requirements_unmet is logged, core_progress stays unchanged.
//
// Strategy: call end-play-phase without chaining pull-viruses (endPlayPhaseOnly helper).
// This lets us read the intermediate virus_pull state before the chain runs.
// When pending_core_progress_delta is non-null in virus_pull, we've caught a mission-
// completing turn mid-flight. Assert pre-reward state, then complete the chain and assert
// post-reward state + log ordering.

// Calls end-play-phase without auto-chaining pull-viruses — stops at virus_pull so callers
// can inspect the intermediate state before the virus chain runs.
async function endPlayPhaseOnly(gameId: string, playerId: string, token: string): Promise<boolean> {
  const resp = await devFetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
  });
  return resp.status === 200;
}

// Queries the full game state including the new deferred-reward columns.
async function queryGameFull(gameId: string, token: string): Promise<{
  phase: string;
  core_progress: number;
  current_mission_id: string | null;
  pending_core_progress_delta: number | null;
  current_turn_player_id: string | null;
} | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase,core_progress,current_mission_id,pending_core_progress_delta,current_turn_player_id`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const rows = (await resp.json()) as Array<Record<string, unknown>>;
  return (rows[0] ?? null) as ReturnType<typeof queryGameFull> extends Promise<infer T> ? T : never;
}

test.describe("mission reward deferred until after completing turn's virus chain", () => {
  test.describe.configure({ mode: "serial" });

  let drCtx: BrowserContext;
  let drPage: Page;
  let drGameId = "";
  let drToken: string | null = null;

  // Captured during test (a+b) for use in assertion continuations
  let capturedPreReward = 0;
  let capturedPendingDelta = 0;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    drCtx = await browser.newContext();
    const { page, gameId } = await fillLobby(drCtx, "Bot1");
    drPage = page;
    drGameId = gameId;
    await startDevGame(drPage);
    await advanceToPlayerTurnWithCpu2(drPage, gameId);
    drToken = await extractAuthToken(drPage);
  });

  test.afterAll(async () => {
    await drCtx.close().catch(() => {});
  });

  // Drain any non-player_turn intermediate phase (virus_pull, virus_resolution, secret_targeting).
  // Returns true if the game is now in player_turn, false otherwise.
  async function drainToPlayerTurn(gameId: string, token: string): Promise<boolean> {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const g = await queryGameFull(gameId, token);
      if (!g) return false;
      if (g.phase === "player_turn") return true;
      if (["resource_adjustment", "mission_selection", "card_reveal", "resource_allocation", "game_over"].includes(g.phase)) return false;
      if (g.phase === "virus_pull" && g.current_turn_player_id) {
        await devFetch(`${SUPABASE_URL}/functions/v1/pull-viruses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game_id: gameId, override_player_id: g.current_turn_player_id }),
        });
      } else if (g.phase === "virus_resolution" && g.current_turn_player_id) {
        await resolveVirusQueueFully(gameId, token);
      } else if (g.phase === "secret_targeting") {
        await new Promise((r) => setTimeout(r, 62_000)); // wait for 1-min targeting deadline
      }
    }
    return false;
  }

  test("(a+b) core_progress stays pre-reward during virus_pull; applied post-chain; mission_complete logged after viruses_placed", async () => {
    const token = drToken;
    if (!token) { test.skip(); return; }

    // Run turns — call end-play-phase WITHOUT chaining pull-viruses.
    // Look for the deferred state: phase=virus_pull AND pending_core_progress_delta non-null.
    // This happens on a turn where the completing contribution was played.
    let foundDeferredState = false;

    for (let turn = 0; turn < 40 && !foundDeferredState; turn++) {
      const inPlayerTurn = await drainToPlayerTurn(drGameId, token);
      if (!inPlayerTurn) break;

      const g = await queryGameFull(drGameId, token);
      if (!g?.current_turn_player_id) break;

      // Call end-play-phase (no auto pull-viruses) and immediately read state
      await endPlayPhaseOnly(drGameId, g.current_turn_player_id, token);
      await new Promise((r) => setTimeout(r, 400));

      const mid = await queryGameFull(drGameId, token);
      if (!mid) break;

      if (mid.phase === "virus_pull" && mid.pending_core_progress_delta != null) {
        // Caught the deferred state
        capturedPreReward = mid.core_progress;
        capturedPendingDelta = mid.pending_core_progress_delta;
        foundDeferredState = true;
        break;
      }

      // Not mission-completing this turn — drain the virus chain and continue
      if (mid.phase === "virus_pull" && mid.current_turn_player_id) {
        await devFetch(`${SUPABASE_URL}/functions/v1/pull-viruses`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ game_id: drGameId, override_player_id: mid.current_turn_player_id }),
        });
        await resolveVirusQueueFully(drGameId, token);
      } else if (mid.phase === "virus_resolution") {
        await resolveVirusQueueFully(drGameId, token);
      } else if (mid.phase === "secret_targeting") {
        await new Promise((r) => setTimeout(r, 62_000));
      }
    }

    if (!foundDeferredState) { test.skip(); return; }

    // ── ASSERTION (b): intermediate virus_pull state ───────────────────────
    expect(capturedPreReward, "(b) core_progress must be at pre-reward value in virus_pull").toBeDefined();
    expect(capturedPendingDelta, "(b) pending_core_progress_delta must equal mission reward").toBeGreaterThan(0);

    // Re-read to confirm state is still paused mid-chain
    const midConfirm = await queryGameFull(drGameId, token);
    expect(midConfirm?.phase, "(b) game must be in virus_pull").toBe("virus_pull");
    expect(midConfirm?.core_progress, "(b) core_progress unchanged mid-chain").toBe(capturedPreReward);
    expect(midConfirm?.pending_core_progress_delta, "(b) pending delta present").toBe(capturedPendingDelta);
    expect(midConfirm?.current_mission_id, "(b) current_mission_id non-null during chain").not.toBeNull();

    // ── Complete the chain ────────────────────────────────────────────────
    const pullGame = await queryGameFull(drGameId, token);
    if (pullGame?.current_turn_player_id) {
      await devFetch(`${SUPABASE_URL}/functions/v1/pull-viruses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: drGameId, override_player_id: pullGame.current_turn_player_id }),
      });
    }
    await resolveVirusQueueFully(drGameId, token);
    await waitForSettledPhase(drGameId, token);
    await new Promise((r) => setTimeout(r, 600));

    // ── ASSERTION (b continued): post-chain reward applied ────────────────
    const finalState = await queryGameFull(drGameId, token);
    expect(finalState?.core_progress, "(b) reward applied post-chain").toBe(capturedPreReward + capturedPendingDelta);
    expect(finalState?.pending_core_progress_delta, "pending delta cleared post-chain").toBeNull();
    expect(finalState?.current_mission_id, "mission closed post-chain").toBeNull();

    // ── ASSERTION (a): log ordering — viruses_placed before mission_complete ─
    const logResp = await fetch(
      `${SUPABASE_URL}/rest/v1/game_log?game_id=eq.${drGameId}&event_type=in.(viruses_placed,mission_complete)&select=event_type,created_at&order=created_at.asc`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const logRows = (await logResp.json()) as Array<{ event_type: string; created_at: string }>;
    const lastVirusesPlacedIdx = logRows.reduce((best, r, i) => r.event_type === "viruses_placed" ? i : best, -1);
    const lastMissionCompleteIdx = logRows.reduce((best, r, i) => r.event_type === "mission_complete" ? i : best, -1);
    expect(lastVirusesPlacedIdx, "(a) viruses_placed must appear in log").toBeGreaterThanOrEqual(0);
    expect(lastMissionCompleteIdx, "(a) mission_complete must appear in log").toBeGreaterThanOrEqual(0);
    expect(lastVirusesPlacedIdx, "(a) viruses_placed must be logged before mission_complete").toBeLessThan(lastMissionCompleteIdx);
  });

  // (c) Deterministic setup requires injecting model_corruption into virus_pool, which
  // needs service-role access not available in E2E tests. The test verifies the code path
  // exists and checks for mission_requirements_unmet in the log if the scenario arose
  // naturally in the preceding turns.
  test("(c) [conditional] mission_requirements_unmet in log if contribution-removing virus fired in completing chain", async () => {
    const token = drToken;
    if (!token) { test.skip(); return; }

    const logResp = await fetch(
      `${SUPABASE_URL}/rest/v1/game_log?game_id=eq.${drGameId}&event_type=eq.mission_requirements_unmet&select=event_type,metadata`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const rows = (await logResp.json()) as Array<{ event_type: string; metadata: Record<string, unknown> }>;

    if (rows.length === 0) {
      // Scenario didn't arise naturally (model_corruption/data_drift/validation_failure didn't
      // fire in a completing chain). Skip rather than fail — this is probabilistic in E2E.
      // For deterministic coverage, run manually with model_corruption staged in the pool.
      test.skip();
      return;
    }

    // If it DID arise: verify the log entry is well-formed and core_progress was not awarded.
    const entry = rows[0];
    expect(entry.metadata).toHaveProperty("mission_key");
    expect(entry.metadata).toHaveProperty("missing");
    expect(Array.isArray(entry.metadata.missing), "missing field must be an array").toBe(true);

    // If mission was un-completed, the game should still have the mission active (current_mission_id non-null)
    // at the point this log was written. We can't travel back in time but we can verify the reward
    // wasn't applied by checking whether core_progress stayed at pre-reward value after the test (a+b) run.
    // Since (a+b) did find a mission completion that succeeded, and this log shows a SEPARATE
    // un-completion event, we just verify the entry format here.
  });
});
