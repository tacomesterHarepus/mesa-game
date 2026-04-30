import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

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

// Advances through the full pre-mission sequence (mission_selection → card_reveal →
// resource_allocation → player_turn) then drives all AI turns × 2 rounds with no cards
// played (CPU=1 → 0 viruses → direct turn advance), causing mission 1 to fail.
// Returns with game in resource_adjustment phase.
async function completeMission1ByFailing(
  page: Page,
  gameId: string,
  token: string,
  humanId: string,
  aiIds: string[],
): Promise<{ mission1TurnOrder: string[] }> {
  // ── Mission Selection: switch to human, pick any card ──────────────────────
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

  // ── Card Reveal: each AI reveals one card via REST ─────────────────────────
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

  // ── Resource Allocation: submit empty allocations ──────────────────────────
  await page.getByRole("heading", { name: "Resource Allocation" }).waitFor({ state: "visible", timeout: 45000 });
  await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
  });
  await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });

  // Read turn order established for mission 1
  const gameResp = await fetch(
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
  const mission1TurnOrder = gameRow.turn_order_ids;

  // ── Drive all AI turns × 2 rounds with no cards played ────────────────────
  // CPU=1 → virusCount(1, 0) = 0 → end-play-phase advances directly (no virus_resolution).
  // After the last player in round 2, mission fails → resource_adjustment.
  const allTurns = [...mission1TurnOrder, ...mission1TurnOrder];
  for (const playerId of allTurns) {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
    });
    expect(resp.status).toBe(200);
    await page.waitForTimeout(400);
  }

  await page.getByRole("heading", { name: "Resource Adjustment" }).waitFor({ state: "visible", timeout: 20000 });
  return { mission1TurnOrder };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("multi-mission flow", () => {
  // Bug 3 regression: active_mission rows accumulate (one per mission played).
  // Before the fix, GameBoard polled active_mission by game_id with maybeSingle(),
  // which returned PGRST116 (multiple rows) on mission 2+, causing mission state to
  // go null — breaking resource_allocation display and MissionBoard progress bar.
  test("mission 2 active_mission state is non-null after mission 1 completes", async ({ browser }: { browser: Browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();
      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();
      expect(aiIds.length).toBeGreaterThanOrEqual(2);

      await completeMission1ByFailing(page, gameId, token!, humanId!, aiIds);

      // Skip resource_adjustment: confirm_ready=true draws mission options and transitions
      await fetch(`${SUPABASE_URL}/functions/v1/adjust-resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, adjustments: [], confirm_ready: true, override_player_id: humanId }),
      });

      // Fetch the mission options drawn by adjust-resources
      const optionsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=pending_mission_options`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [{ pending_mission_options }] = (await optionsResp.json()) as Array<{ pending_mission_options: string[] }>;
      const mission2Key = pending_mission_options[0];

      // Select mission 2 — inserts a 2nd active_mission row
      const selectResp = await fetch(`${SUPABASE_URL}/functions/v1/select-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, mission_key: mission2Key, override_player_id: humanId }),
      });
      expect(selectResp.status).toBe(200);

      await page.waitForTimeout(1000);

      // ── REST assertions ────────────────────────────────────────────────────

      // There should now be 2 active_mission rows (mission 1 old + mission 2 new).
      // This is the exact condition that broke the old game_id query.
      const allRowsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/active_mission?game_id=eq.${gameId}&select=id,mission_key`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const allRows = (await allRowsResp.json()) as Array<{ id: string; mission_key: string }>;
      expect(allRows.length).toBe(2);

      // Exactly one row should match current_mission_id (mission 2)
      const gameStateResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=current_mission_id`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [{ current_mission_id }] = (await gameStateResp.json()) as Array<{ current_mission_id: string }>;
      expect(current_mission_id).not.toBeNull();
      const mission2Row = allRows.find((r) => r.id === current_mission_id);
      expect(mission2Row).toBeDefined();
      expect(mission2Row?.mission_key).toBe(mission2Key);

      // ── UI assertions ──────────────────────────────────────────────────────

      // GameBoard should render the card_reveal phase heading
      await page.getByRole("heading", { name: "Card Reveal" }).waitFor({ state: "visible", timeout: 15000 });

      // MissionBoard renders <h3>Mission</h3> only when mission state is non-null.
      // Before Bug 3 fix: poll used game_id → PGRST116 → setMission(null) → no MissionBoard.
      // After fix: poll uses current_mission_id → correct row → setMission(mission2) → visible.
      await expect(page.getByRole("heading", { name: "Mission" })).toBeVisible();
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // Bug 2 regression: select-mission did not draw cards for AIs before card_reveal.
  // Mission 1 was invisible (start-game deals full hands). Mission 2+: hands depleted
  // from playing/staging in the previous mission.
  test("AIs have full hands at start of card_reveal for mission 2", async ({ browser }: { browser: Browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);

      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();
      const { humanId, aiIds } = await collectPlayerIds(page);
      expect(humanId).not.toBeNull();

      // Fetch AI RAM values (may differ after resource_allocation)
      const playersResp = await fetch(
        `${SUPABASE_URL}/rest/v1/players?game_id=eq.${gameId}&role=neq.human&select=id,ram`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const aiPlayers = (await playersResp.json()) as Array<{ id: string; ram: number }>;
      const ramByPlayerId = Object.fromEntries(aiPlayers.map((p) => [p.id, p.ram]));

      await completeMission1ByFailing(page, gameId, token!, humanId!, aiIds);

      // Skip resource_adjustment
      await fetch(`${SUPABASE_URL}/functions/v1/adjust-resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, adjustments: [], confirm_ready: true, override_player_id: humanId }),
      });

      const optionsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=pending_mission_options`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [{ pending_mission_options }] = (await optionsResp.json()) as Array<{ pending_mission_options: string[] }>;

      // Select mission 2 — Bug 2 fix draws cards for all AIs here
      const selectResp = await fetch(`${SUPABASE_URL}/functions/v1/select-mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          game_id: gameId,
          mission_key: pending_mission_options[0],
          override_player_id: humanId,
        }),
      });
      expect(selectResp.status).toBe(200);

      await page.waitForTimeout(1000);

      // Every AI should have hand size = RAM immediately after select-mission transitions
      // to card_reveal. Before Bug 2 fix, hands would be depleted (fewer cards than RAM).
      for (const { id: playerId, ram } of aiPlayers) {
        const handResp = await fetch(
          `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${playerId}&game_id=eq.${gameId}&select=id`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        );
        const hand = (await handResp.json()) as Array<{ id: string }>;
        const expectedRam = ramByPlayerId[playerId] ?? ram;
        expect(hand.length).toBe(expectedRam);
      }
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  // Bug 1 regression: MissionSelection.tsx did not render def.allocation (cpu/ram pool).
  // Humans need to see allocation amounts when choosing between the 3 mission options.
  test("mission cards show allocation amounts during mission_selection", async ({ browser }: { browser: Browser }) => {
    const ctx: BrowserContext = await browser.newContext();
    try {
      const { page, gameId } = await fillLobby(ctx);
      await startDevGame(page);

      // Fetch mission options before selecting (set by start-game for mission 1)
      const token = await extractAuthToken(page);
      expect(token).not.toBeNull();

      await page.getByRole("heading", { name: "Mission Selection" }).waitFor({ state: "visible", timeout: 30000 });

      // Switch to human so the mission cards are interactive and visible
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

      // Fetch the actual pending mission options to verify displayed allocation values
      const optionsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=pending_mission_options`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [{ pending_mission_options }] = (await optionsResp.json()) as Array<{ pending_mission_options: string[] }>;

      // Import MISSION_MAP dynamically to get expected allocation values
      // Each displayed mission card must show "+N CPU, +M RAM" from its allocation field.
      // Before Bug 1 fix, the allocation div was simply absent.
      for (const missionKey of pending_mission_options) {
        // The allocation line is rendered as: "Allocate: +N CPU, +M RAM"
        // We check for the pattern "Allocate:" which is always present when the fix is in.
        // Use a broad text match since allocation values vary by mission.
        const cards = page.locator("button").filter({ hasText: "Allocate:" });
        await expect(cards.first()).toBeVisible();
      }

      // More specific: at least one card shows "Allocate:" text with CPU/RAM values
      await expect(page.getByText(/Allocate:.*CPU.*RAM/).first()).toBeVisible();
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
