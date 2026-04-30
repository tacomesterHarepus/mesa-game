import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE_URL = "https://qpoakdiwmpaxvvzpqqdh.supabase.co";
const ANON_KEY = "sb_publishable_Kz82SiJlbKrdJ0ZtAQPEkg_mm-0aapD";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fillLobby(ctx: BrowserContext): Promise<{ page: Page; gameId: string }> {
  const page = await ctx.newPage();
  await page.goto("/game/create");
  await page.getByLabel("Display name").fill("LogBot");
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
    if (label.includes("H")) { if (!humanId) humanId = id; }
    else { aiIds.push(id); }
  }
  return { humanId, aiIds };
}

// Queries game_log for all entries of a given event_type, ordered by created_at.
async function getLogEntries(
  gameId: string,
  token: string,
  eventType: string,
): Promise<Array<{ event_type: string; metadata: Record<string, unknown> }>> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/game_log?game_id=eq.${gameId}&event_type=eq.${eventType}&select=event_type,metadata&order=created_at.asc`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  return (await resp.json()) as Array<{ event_type: string; metadata: Record<string, unknown> }>;
}

// Queries all game_log entries with created_at for ordering checks.
async function getAllLogEntriesWithTimestamp(
  gameId: string,
  token: string,
): Promise<Array<{ event_type: string; created_at: string }>> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/game_log?game_id=eq.${gameId}&select=event_type,created_at&order=created_at.asc`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  return (await resp.json()) as Array<{ event_type: string; created_at: string }>;
}

// Calls resolve-next-virus until the game leaves virus_resolution.
// Also force-resolves any secret_targeting interruptions (targeting cards in the pool
// cause resolve-next-virus to pause the chain — we skip the vote and pick randomly).
async function drainVirusQueue(gameId: string, token: string, overridePlayerId?: string): Promise<void> {
  for (let i = 0; i < 25; i++) {
    const phaseResp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=phase`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [row] = (await phaseResp.json()) as Array<{ phase: string }>;
    if (row?.phase === "secret_targeting") {
      // secret-target uses .single() to resolve the caller — in dev mode all players
      // share the same user_id, so override_player_id is required to avoid a multi-row error.
      await fetch(`${SUPABASE_URL}/functions/v1/secret-target`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, force_resolve: true, override_player_id: overridePlayerId }),
      });
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    if (row?.phase !== "virus_resolution") break;
    await fetch(`${SUPABASE_URL}/functions/v1/resolve-next-virus`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId }),
    });
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────
// Runs one full failed mission (2 rounds, no requirements met) to populate
// game_log with the widest possible set of event types.
// Card_played and related metadata are tested if player 1 has a progress card.

test.describe("game_log metadata coverage", () => {
  test.describe.configure({ mode: "serial" });

  let ctx: BrowserContext;
  let page: Page;
  let gameId: string;
  let token: string;
  let humanId: string;
  let aiIds: string[];
  let turnOrderIds: string[];
  let firstAiId: string;
  let cardPlayedEventFired = false;

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext();
    ({ page, gameId } = await fillLobby(ctx));
    await startDevGame(page);

    token = (await extractAuthToken(page))!;
    expect(token).not.toBeNull();

    ({ humanId, aiIds } = await collectPlayerIds(page));
    expect(humanId).not.toBeNull();
    expect(aiIds.length).toBeGreaterThan(0);

    // ── Mission Selection ──────────────────────────────────────────────────────
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
    await page.locator("button:not([name])").filter({ hasText: /Compute|Data|Validation/ }).first().click();
    await page.getByRole("button", { name: "Select Mission" }).click();

    // ── Card Reveal ────────────────────────────────────────────────────────────
    await page.getByRole("heading", { name: "Card Reveal" }).waitFor({ state: "visible", timeout: 15000 });
    for (const playerId of aiIds) {
      const handResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${playerId}&game_id=eq.${gameId}&select=id,card_key,card_type`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
      );
      const hand = (await handResp.json()) as Array<{ id: string; card_key: string; card_type: string }>;
      if (!hand.length) continue;
      await fetch(`${SUPABASE_URL}/functions/v1/reveal-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_key: hand[0].card_key, override_player_id: playerId }),
      });
      await page.waitForTimeout(300);
    }

    // ── Resource Allocation (empty) ────────────────────────────────────────────
    await page.getByRole("heading", { name: "Resource Allocation" }).waitFor({ state: "visible", timeout: 15000 });
    await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
    });
    await page.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 15000 });

    // ── Get turn order ─────────────────────────────────────────────────────────
    const gameResp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=turn_order_ids,current_mission_id`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const [gameRow] = (await gameResp.json()) as Array<{
      turn_order_ids: string[];
      current_mission_id: string;
    }>;
    turnOrderIds = gameRow.turn_order_ids;
    firstAiId = turnOrderIds[0];

    // ── Round 1, player 1: discard → play card → end turn ─────────────────────
    await fetch(`${SUPABASE_URL}/functions/v1/discard-cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, card_ids: [], override_player_id: firstAiId }),
    });
    await page.waitForTimeout(400);

    // Play a progress card if player 1 has one (not guaranteed — deck is random)
    const handResp = await fetch(
      `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${firstAiId}&game_id=eq.${gameId}&select=id,card_key,card_type`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    const hand = (await handResp.json()) as Array<{ id: string; card_key: string; card_type: string }>;
    const progressCard = hand.find((c) => c.card_type === "progress");
    if (progressCard) {
      const playResp = await fetch(`${SUPABASE_URL}/functions/v1/play-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, card_id: progressCard.id, override_player_id: firstAiId }),
      });
      cardPlayedEventFired = playResp.status === 200;
      await page.waitForTimeout(400);
    }

    // End player 1's turn
    await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, override_player_id: firstAiId }),
    });
    await page.waitForTimeout(400);

    // ── Round 1, players 2-N: end-play-phase only ──────────────────────────────
    for (const playerId of turnOrderIds.slice(1)) {
      await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
      });
      await page.waitForTimeout(400);
    }

    // ── Round 2: all players end-play-phase — last player triggers mission_failed
    for (const playerId of turnOrderIds) {
      await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ game_id: gameId, override_player_id: playerId }),
      });
      await page.waitForTimeout(400);
    }

    await page.getByRole("heading", { name: "Resource Adjustment" }).waitFor({ state: "visible", timeout: 20000 });
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => {});
  });

  // ── Tests ─────────────────────────────────────────────────────────────────────

  test("game_started: player_count is 6", async () => {
    const entries = await getLogEntries(gameId, token, "game_started");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.player_count).toBe(6);
  });

  test("mission_selected: has mission_key string and 3-element mission_options array", async () => {
    const entries = await getLogEntries(gameId, token, "mission_selected");
    expect(entries).toHaveLength(1);
    const meta = entries[0].metadata;
    expect(typeof meta.mission_key).toBe("string");
    expect(Array.isArray(meta.mission_options)).toBe(true);
    expect((meta.mission_options as unknown[]).length).toBe(3);
  });

  test("card_revealed: has actor_player_id, card_key, and valid card_type", async () => {
    const entries = await getLogEntries(gameId, token, "card_revealed");
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const meta = entries[0].metadata;
    expect(typeof meta.actor_player_id).toBe("string");
    expect(typeof meta.card_key).toBe("string");
    expect(["compute", "data", "validation", "virus"]).toContain(meta.card_type);
  });

  test("reveal_done: metadata is empty object", async () => {
    const entries = await getLogEntries(gameId, token, "reveal_done");
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toEqual({});
  });

  test("allocation_done: has allocations array", async () => {
    const entries = await getLogEntries(gameId, token, "allocation_done");
    expect(entries).toHaveLength(1);
    expect(Array.isArray(entries[0].metadata.allocations)).toBe(true);
  });

  test("turn_start (round 1): has actor_player_id and round: 1", async () => {
    const entries = await getLogEntries(gameId, token, "turn_start");
    const round1 = entries.filter((e) => e.metadata.round === 1);
    expect(round1.length).toBeGreaterThanOrEqual(1);
    expect(typeof round1[0].metadata.actor_player_id).toBe("string");
  });

  test("discard: actor_player_id is firstAiId and count is 0", async () => {
    const entries = await getLogEntries(gameId, token, "discard");
    expect(entries).toHaveLength(1);
    const meta = entries[0].metadata;
    expect(meta.actor_player_id).toBe(firstAiId);
    expect(meta.count).toBe(0);
  });

  test("card_played: full metadata shape — actor, card_key, card_type, failed, mission_progress", async () => {
    const entries = await getLogEntries(gameId, token, "card_played");
    if (!cardPlayedEventFired || entries.length === 0) return; // player 1 had no progress cards
    const meta = entries[0].metadata;
    expect(meta.actor_player_id).toBe(firstAiId);
    expect(typeof meta.card_key).toBe("string");
    expect(["compute", "data", "validation"]).toContain(meta.card_type);
    expect(meta.failed).toBe(false);
    expect(meta.mission_progress).toBeDefined();
    const mp = meta.mission_progress as Record<string, unknown>;
    expect(typeof mp.compute).toBe("number");
    expect(typeof mp.data).toBe("number");
    expect(typeof mp.validation).toBe("number");
  });

  test("viruses_placed: has actor_player_id and numeric count", async () => {
    const entries = await getLogEntries(gameId, token, "viruses_placed");
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const meta = entries[0].metadata;
    expect(typeof meta.actor_player_id).toBe("string");
    expect(typeof meta.count).toBe("number");
  });

  test("round_start: round is 2 and first_player_id is a string", async () => {
    const entries = await getLogEntries(gameId, token, "round_start");
    expect(entries).toHaveLength(1);
    const meta = entries[0].metadata;
    expect(meta.round).toBe(2);
    expect(typeof meta.first_player_id).toBe("string");
  });

  test("turn_start (round 2): at least one entry with round: 2", async () => {
    const entries = await getLogEntries(gameId, token, "turn_start");
    const round2 = entries.filter((e) => e.metadata.round === 2);
    expect(round2.length).toBeGreaterThanOrEqual(1);
  });

  test("mission_failed: has mission_key, positive penalty, and new_timer", async () => {
    const entries = await getLogEntries(gameId, token, "mission_failed");
    expect(entries).toHaveLength(1);
    const meta = entries[0].metadata;
    expect(typeof meta.mission_key).toBe("string");
    expect(typeof meta.penalty).toBe("number");
    expect(meta.penalty as number).toBeGreaterThan(0);
    expect(typeof meta.new_timer).toBe("number");
  });

  test("mission_transition: outcome is 'failed' with next_first_player_id and completing_player_id", async () => {
    const entries = await getLogEntries(gameId, token, "mission_transition");
    expect(entries).toHaveLength(1);
    const meta = entries[0].metadata;
    expect(meta.mission_outcome).toBe("failed");
    expect(typeof meta.next_first_player_id).toBe("string");
    expect(typeof meta.completing_player_id).toBe("string");
  });

  // Conditional: only fires when CPU ≥ 2 (all players start at CPU 1 in dev mode)
  test("virus_queue_start (when present): has actor_player_id, virus_count, pool_size_after", async () => {
    const entries = await getLogEntries(gameId, token, "virus_queue_start");
    if (entries.length === 0) return;
    const meta = entries[0].metadata;
    expect(typeof meta.actor_player_id).toBe("string");
    expect(typeof meta.virus_count).toBe("number");
    expect(typeof meta.pool_size_after).toBe("number");
  });

  // Conditional: only fires when a virus card is resolved from the queue
  test("virus_effect (when present): has card_key and effect_type", async () => {
    const entries = await getLogEntries(gameId, token, "virus_effect");
    if (entries.length === 0) return;
    const meta = entries[0].metadata;
    expect(typeof meta.card_key).toBe("string");
    expect(typeof meta.effect_type).toBe("string");
  });

  // Conditional: only fires when a progress card is resolved from the virus pool
  test("virus_no_effect (when present): has card_key and card_type", async () => {
    const entries = await getLogEntries(gameId, token, "virus_no_effect");
    if (entries.length === 0) return;
    const meta = entries[0].metadata;
    expect(typeof meta.card_key).toBe("string");
    expect(typeof meta.card_type).toBe("string");
  });
});

// ── CPU≥2 ordering suite ──────────────────────────────────────────────────────
// Verifies that mission_transition fires AFTER all virus events when the
// completing player has CPU≥2 (virus path through resolve-next-virus).
// Uses a separate game so the queue-drain calls don't affect the first suite.

test.describe("game_log mission_transition ordering (CPU≥2 virus path)", () => {
  test.describe.configure({ mode: "serial" });

  let ctx2: BrowserContext;
  let page2: Page;
  let gameId2: string;
  let token2: string;
  let humanId2: string | null;
  let aiIds2: string[];
  let turnOrderIds2: string[];

  test.beforeAll(async ({ browser }) => {
    ctx2 = await browser.newContext();
    ({ page: page2, gameId: gameId2 } = await fillLobby(ctx2));
    await startDevGame(page2);

    token2 = (await extractAuthToken(page2))!;
    expect(token2).not.toBeNull();

    ({ humanId: humanId2, aiIds: aiIds2 } = await collectPlayerIds(page2));
    expect(aiIds2.length).toBeGreaterThan(0);

    // ── Mission Selection ──────────────────────────────────────────────────────
    await page2.getByRole("heading", { name: "Mission Selection" }).waitFor({ state: "visible", timeout: 30000 });
    const switcherPanel2 = page2.locator(".fixed.top-7");
    const playerButtons2 = switcherPanel2.getByRole("button");
    const btnCount2 = await playerButtons2.count();
    for (let i = 0; i < btnCount2; i++) {
      await playerButtons2.nth(i).click();
      await page2.waitForTimeout(200);
      const label = await playerButtons2.nth(i).textContent();
      if (label?.includes("H")) break;
    }
    await page2.locator("button:not([name])").filter({ hasText: /Compute|Data|Validation/ }).first().click();
    await page2.getByRole("button", { name: "Select Mission" }).click();

    // ── Card Reveal ────────────────────────────────────────────────────────────
    await page2.getByRole("heading", { name: "Card Reveal" }).waitFor({ state: "visible", timeout: 30000 });
    for (const playerId of aiIds2) {
      const handResp = await fetch(
        `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${playerId}&game_id=eq.${gameId2}&select=id,card_key,card_type`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token2}` } }
      );
      const hand = (await handResp.json()) as Array<{ id: string; card_key: string; card_type: string }>;
      if (!hand.length) continue;
      await fetch(`${SUPABASE_URL}/functions/v1/reveal-card`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
        body: JSON.stringify({ game_id: gameId2, card_key: hand[0].card_key, override_player_id: playerId }),
      });
      await page2.waitForTimeout(300);
    }

    // ── Resource Allocation — give LAST player in turn order +1 CPU ────────────
    await page2.getByRole("heading", { name: "Resource Allocation" }).waitFor({ state: "visible", timeout: 30000 });

    const gameResp = await fetch(
      `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId2}&select=turn_order_ids`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token2}` } }
    );
    const [gameRow] = (await gameResp.json()) as Array<{ turn_order_ids: string[] }>;
    turnOrderIds2 = gameRow.turn_order_ids;
    const lastAiId = turnOrderIds2[turnOrderIds2.length - 1];

    await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
      body: JSON.stringify({
        game_id: gameId2,
        allocations: [{ player_id: lastAiId, cpu_delta: 1, ram_delta: 0 }],
        override_player_id: humanId2,
      }),
    });
    await page2.locator("p").filter({ hasText: /Player Turn/ }).first().waitFor({ state: "visible", timeout: 30000 });

    // ── Round 1: all players end-play-phase; drain viruses after each ────────────
    for (const playerId of turnOrderIds2) {
      await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
        body: JSON.stringify({ game_id: gameId2, override_player_id: playerId }),
      });
      await page2.waitForTimeout(400);
      // Last player in round 1 has CPU=2 and will generate viruses — drain them.
      // Pass humanId2 as override so secret-target's .single() resolves correctly in dev mode.
      await drainVirusQueue(gameId2, token2, humanId2 ?? aiIds2[0]);
    }

    // ── Round 2: same; last player triggers mission_failed + virus path ─────────
    for (const playerId of turnOrderIds2) {
      await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token2}` },
        body: JSON.stringify({ game_id: gameId2, override_player_id: playerId }),
      });
      await page2.waitForTimeout(400);
      // After last player's end-play-phase: mission_failed + virus path.
      // drainVirusQueue triggers resolve-next-virus, which reads pending_mission_outcome
      // and emits mission_transition after all virus events.
      await drainVirusQueue(gameId2, token2, humanId2 ?? aiIds2[0]);
    }

    await page2.getByRole("heading", { name: "Resource Adjustment" }).waitFor({ state: "visible", timeout: 20000 });
  });

  test.afterAll(async () => {
    await ctx2?.close().catch(() => {});
  });

  test("mission_transition fires and appears after all virus events in created_at order", async () => {
    const allEntries = await getAllLogEntriesWithTimestamp(gameId2, token2);

    const transitionEntry = allEntries.find((e) => e.event_type === "mission_transition");
    expect(transitionEntry).toBeDefined();

    // The last player (CPU=2) must have generated viruses in round 2 — verify the log shows it.
    const virusQueueEntries = allEntries.filter((e) => e.event_type === "virus_queue_start");
    expect(virusQueueEntries.length).toBeGreaterThan(0);

    // mission_transition must appear after every virus_queue_start, virus_effect, virus_no_effect.
    const transitionTime = new Date(transitionEntry!.created_at).getTime();
    const virusEventTypes = new Set(["virus_queue_start", "virus_effect", "virus_no_effect"]);
    const allVirusEntries = allEntries.filter((e) => virusEventTypes.has(e.event_type));

    for (const virusEntry of allVirusEntries) {
      const virusTime = new Date(virusEntry.created_at).getTime();
      expect(transitionTime).toBeGreaterThanOrEqual(virusTime);
    }
  });
});
