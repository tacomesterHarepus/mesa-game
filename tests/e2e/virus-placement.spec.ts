import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

const CARD_NAMES: Record<string, string> = {
  compute: "Compute",
  data: "Data",
  validation: "Validation",
  cascading_failure: "Cascading Failure",
  system_overload: "System Overload",
  model_corruption: "Model Corruption",
  data_drift: "Data Drift",
  validation_failure: "Validation Failure",
  pipeline_breakdown: "Pipeline Breakdown",
  dependency_error: "Dependency Error",
  process_crash: "Process Crash",
  memory_leak: "Memory Leak",
  resource_surge: "Resource Surge",
  cpu_drain: "CPU Drain",
  memory_allocation: "Memory Allocation",
};

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

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("virus placement", () => {
  test("staged card appears in virus pool after End Turn", async ({ browser }) => {
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

      // Get turn order so we know who goes first
      const gameResp = await fetch(
        `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
      const firstPlayerId = gameRow.turn_order_ids[0];

      // Give first AI CPU=2 → 1 virus staging slot per turn
      const allocResp = await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          game_id: gameId,
          allocations: [{ player_id: firstPlayerId, cpu_delta: 1, ram_delta: 0 }],
          override_player_id: humanId,
        }),
      });
      if (!allocResp.ok) {
        test.skip();
        return;
      }

      await page.getByText("Player Turn").waitFor({ state: "visible", timeout: 15000 });

      // Read first player's hand — need card_key to verify pool membership after End Turn
      const handResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${firstPlayerId}&game_id=eq.${gameId}&select=id,card_key,card_type`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand = (await handResp.json()) as Array<{ id: string; card_key: string; card_type: string }>;
      if (!hand.length) {
        test.skip();
        return;
      }
      const stagedCardKey = hand[0].card_key;
      const stagedCardName = CARD_NAMES[stagedCardKey] ?? stagedCardKey;

      // Baseline: count of this card_key in pool + queue before End Turn.
      // Mathematical proof: after end-play-phase with CPU=2, the staged card is added at
      // the highest pool position and the 1 drawn card comes from the lowest (position 0).
      // So pool.count(K) + queue.count(K) increases by exactly 1 regardless of overlap.
      const [poolBefore, queueBefore] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/virus_pool?game_id=eq.${gameId}&card_key=eq.${stagedCardKey}&select=id`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        ).then((r) => r.json() as Promise<Array<{ id: string }>>),
        fetch(
          `${SUPABASE_URL}/rest/v1/virus_resolution_queue?game_id=eq.${gameId}&card_key=eq.${stagedCardKey}&resolved=eq.false&select=id`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        ).then((r) => r.json() as Promise<Array<{ id: string }>>),
      ]);
      const countBefore = poolBefore.length + queueBefore.length;

      // Switch to first AI player in the DevModeOverlay switcher
      const switcherPanel = page.locator(".fixed.top-7");
      const allButtons = switcherPanel.locator("[data-player-id]");
      const btnCount = await allButtons.count();
      for (let i = 0; i < btnCount; i++) {
        const btn = allButtons.nth(i);
        const pid = await btn.getAttribute("data-player-id");
        if (pid === firstPlayerId) {
          await btn.click();
          break;
        }
      }
      await page.waitForTimeout(500);

      await expect(page.getByText("It's your turn.")).toBeVisible({ timeout: 10000 });

      // Complete the discard step before staging is available
      const skipDiscardBtn = page.getByRole("button", { name: "Skip Discard" });
      if (await skipDiscardBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await skipDiscardBtn.click();
        // Wait for play phase to appear (End Turn = play phase rendered)
        await page.getByRole("button", { name: "End Turn" }).waitFor({ state: "visible", timeout: 10000 });
      }

      // Select and stage the known card: click by display name, then "Stage for Pool"
      await page.getByRole("button", { name: stagedCardName, exact: true }).first().click();
      await page.waitForTimeout(200);
      await page.getByRole("button", { name: "Stage for Pool" }).click();
      await page.waitForTimeout(200);

      // Staging zone should show "1 / 1 staged" confirming local state
      await expect(page.getByText("1 / 1 staged")).toBeVisible({ timeout: 5000 });

      // Click End Turn — now unblocked (stagingNeeded = 0)
      await page.getByRole("button", { name: "End Turn" }).click();

      // Wait for phase to change away from player_turn (place-virus + end-play-phase run sequentially)
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(1000);
        const stateResp = await fetch(
          `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        );
        const [stateRow] = (await stateResp.json()) as Array<{ phase: string }>;
        if (stateRow.phase !== "player_turn") break;
      }
      await page.waitForTimeout(500);

      // After end-play-phase: staged card is in pool or queue (pool.count + queue.count = B + 1)
      const [poolAfter, queueAfter] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/virus_pool?game_id=eq.${gameId}&card_key=eq.${stagedCardKey}&select=id`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        ).then((r) => r.json() as Promise<Array<{ id: string }>>),
        fetch(
          `${SUPABASE_URL}/rest/v1/virus_resolution_queue?game_id=eq.${gameId}&card_key=eq.${stagedCardKey}&resolved=eq.false&select=id`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
        ).then((r) => r.json() as Promise<Array<{ id: string }>>),
      ]);
      const countAfter = poolAfter.length + queueAfter.length;

      expect(countAfter).toBe(countBefore + 1);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
