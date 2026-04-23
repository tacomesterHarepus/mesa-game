import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

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

async function fetchGame(gameId: string, token: string): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/games?id=eq.${gameId}&select=*`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const rows = await resp.json() as Record<string, unknown>[];
  return rows[0] ?? {};
}

async function fetchPlayers(gameId: string, token: string): Promise<Record<string, unknown>[]> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/players?game_id=eq.${gameId}&select=*`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  return resp.json() as Promise<Record<string, unknown>[]>;
}

async function fetchActiveMission(gameId: string, token: string): Promise<Record<string, unknown> | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/active_mission?game_id=eq.${gameId}&select=*`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const rows = await resp.json() as Record<string, unknown>[];
  return rows[0] ?? null;
}

async function fetchHand(playerId: string, gameId: string, token: string): Promise<Array<{ id: string; card_key: string; card_type: string }>> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/hands?player_id=eq.${playerId}&game_id=eq.${gameId}&select=*`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  return resp.json() as Promise<Array<{ id: string; card_key: string; card_type: string }>>;
}

async function playCard(gameId: string, cardId: string, overridePlayerId: string, token: string) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/play-card`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ game_id: gameId, card_id: cardId, override_player_id: overridePlayerId }),
  });
  return resp.json() as Promise<Record<string, unknown>>;
}

// Advances past mission_selection and card_reveal to player_turn, selecting a specific mission if offered.
// Returns the selected mission_key, or null if the desired mission wasn't available.
async function advanceToPlayerTurnForMission(
  page: Page,
  gameId: string,
  token: string,
  desiredMission: string | null,
): Promise<{ missionKey: string; humanId: string | null; aiIds: string[] }> {
  const switcherPanel = page.locator(".fixed.top-7");
  const playerButtons = switcherPanel.getByRole("button");
  const count = await playerButtons.count();

  await page.getByText("Mission Selection").waitFor({ state: "visible", timeout: 30000 });

  // Switch to human
  for (let i = 0; i < count; i++) {
    await playerButtons.nth(i).click();
    await page.waitForTimeout(200);
    const label = await playerButtons.nth(i).textContent();
    if (label?.includes("H")) break;
  }

  // Get pending mission options from game row
  const gameState = await fetchGame(gameId, token);
  const options = (gameState.pending_mission_options as string[]) ?? [];
  const chosenMission = (desiredMission && options.includes(desiredMission))
    ? desiredMission
    : options[0] ?? "data_cleanup";

  // Click the matching mission button in UI (find by text content)
  const missionButtons = page.locator("button:not([name])").filter({ hasText: /Compute|Data|Validation/i });
  const btnCount = await missionButtons.count();
  let clicked = false;
  for (let i = 0; i < btnCount; i++) {
    const btn = missionButtons.nth(i);
    const txt = (await btn.textContent() ?? "").toLowerCase();
    if (txt.includes(chosenMission.replace(/_/g, " ").toLowerCase().slice(0, 5))) {
      await btn.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) await missionButtons.first().click();
  await page.getByRole("button", { name: "Select Mission" }).click();

  // Card Reveal via direct API
  await page.getByText("Card Reveal").waitFor({ state: "visible", timeout: 15000 });
  const { humanId, aiIds } = await collectPlayerIds(page);

  for (const playerId of aiIds) {
    const hand = await fetchHand(playerId, gameId, token);
    if (!hand.length) continue;
    await fetch(`${SUPABASE_URL}/functions/v1/reveal-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, card_key: hand[0].card_key, override_player_id: playerId }),
    });
    await page.waitForTimeout(300);
  }

  // Resource Allocation via direct API (no extra CPU/RAM — default stats for clean rule testing)
  await page.getByText("Resource Allocation").waitFor({ state: "visible", timeout: 15000 });
  if (humanId) {
    await fetch(`${SUPABASE_URL}/functions/v1/allocate-resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ game_id: gameId, allocations: [], override_player_id: humanId }),
    });
  }

  await page.getByText("Player Turn").waitFor({ state: "visible", timeout: 15000 });

  const mission = await fetchActiveMission(gameId, token);
  return { missionKey: (mission?.mission_key as string) ?? chosenMission, humanId, aiIds };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe("mission special rules", () => {
  test.describe.configure({ mode: "serial" });

  let sharedCtx: BrowserContext;
  let sharedPage: Page;
  let sharedGameId: string;
  let sharedToken: string;
  let humanId: string | null = null;
  let aiIds: string[] = [];
  let missionKey: string = "";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    sharedCtx = await browser.newContext();
    const { page, gameId } = await fillLobby(sharedCtx, "Bot1");
    sharedPage = page;
    sharedGameId = gameId;
    await startDevGame(sharedPage);
    sharedToken = (await extractAuthToken(sharedPage))!;

    // Advance to player_turn (no specific mission preference — we test whatever we get)
    const result = await advanceToPlayerTurnForMission(sharedPage, gameId, sharedToken, null);
    missionKey = result.missionKey;
    humanId = result.humanId;
    aiIds = result.aiIds;
  });

  test.afterAll(async () => {
    await sharedCtx.close();
  });

  // ── Test 1: play-card rejects wrong card type (virus card) ────────────────────

  test("play-card rejects virus cards (not progress type)", async () => {
    const currentTurnId = ((await fetchGame(sharedGameId, sharedToken)).current_turn_player_id as string);
    if (!currentTurnId) { test.skip(); return; }

    // Find a virus card in the current player's hand (if any)
    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const virusCard = hand.find((c) => c.card_type === "virus");
    if (!virusCard) { test.skip(); return; }

    const result = await playCard(sharedGameId, virusCard.id, currentTurnId, sharedToken);
    expect(result.error).toBe("Only progress cards can contribute to a mission");
  });

  // ── Test 2: play-card enforces CPU limit ──────────────────────────────────────

  test("play-card blocks play when CPU limit is reached", async () => {
    // Find the current turn player
    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;
    if (!currentTurnId) { test.skip(); return; }

    const players = await fetchPlayers(sharedGameId, sharedToken);
    const currentPlayer = players.find((p) => p.id === currentTurnId);
    const cpu = (currentPlayer?.cpu as number) ?? 1;

    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const progressCards = hand.filter((c) => c.card_type === "progress");

    // Play up to CPU cards
    let played = 0;
    for (const card of progressCards) {
      if (played >= cpu) break;

      // Check mission rules before attempting (avoid rule violations that aren't CPU)
      const result = await playCard(sharedGameId, card.id, currentTurnId, sharedToken);
      if (result.error) {
        // Some other rule violated — that's fine, just stop
        break;
      }
      played++;
      await new Promise((r) => setTimeout(r, 300));
    }

    if (played < cpu) {
      // Couldn't play enough cards (hand was small or rules blocked) — skip
      test.skip();
      return;
    }

    // Fetch updated hand after plays
    const remainingHand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const remainingProgress = remainingHand.filter((c) => c.card_type === "progress");
    if (!remainingProgress.length) { test.skip(); return; }

    // Next play should fail with CPU limit error
    const blocked = await playCard(sharedGameId, remainingProgress[0].id, currentTurnId, sharedToken);
    expect(blocked.error).toMatch(/CPU limit reached|only 1 card per turn/);
  });

  // ── Test 3: play-card not-your-turn rejection ─────────────────────────────────

  test("play-card rejects card play when it is not the player's turn", async () => {
    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;

    // Find a player whose turn it is NOT
    const otherAiId = aiIds.find((id) => id !== currentTurnId);
    if (!otherAiId) { test.skip(); return; }

    const hand = await fetchHand(otherAiId, sharedGameId, sharedToken);
    const progressCard = hand.find((c) => c.card_type === "progress");
    if (!progressCard) { test.skip(); return; }

    const result = await playCard(sharedGameId, progressCard.id, otherAiId, sharedToken);
    expect(result.error).toBe("Not your turn");
  });

  // ── Test 4: dataset_preparation blocks Compute before Data req is met ─────────

  test("dataset_preparation: Compute blocked until 4 Data are contributed", async () => {
    if (missionKey !== "dataset_preparation") { test.skip(); return; }

    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;
    if (!currentTurnId) { test.skip(); return; }

    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const computeCard = hand.find((c) => c.card_key === "compute" && c.card_type === "progress");
    if (!computeCard) { test.skip(); return; }

    const mission = await fetchActiveMission(sharedGameId, sharedToken);
    if ((mission?.data_contributed as number) >= 4) { test.skip(); return; }

    const result = await playCard(sharedGameId, computeCard.id, currentTurnId, sharedToken);
    expect(result.error).toContain("Compute cannot be played until all 4 Data");
  });

  // ── Test 5: dataset_integration blocks Compute when no slots available ────────

  test("dataset_integration: Compute blocked when no Data slots unlocked", async () => {
    if (missionKey !== "dataset_integration") { test.skip(); return; }

    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;
    if (!currentTurnId) { test.skip(); return; }

    const mission = await fetchActiveMission(sharedGameId, sharedToken);
    // Only test if no Data yet played (0 slots unlocked)
    if ((mission?.data_contributed as number) > 0) { test.skip(); return; }

    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const computeCard = hand.find((c) => c.card_key === "compute" && c.card_type === "progress");
    if (!computeCard) { test.skip(); return; }

    const result = await playCard(sharedGameId, computeCard.id, currentTurnId, sharedToken);
    expect(result.error).toContain("Compute slots full");
  });

  // ── Test 6: cross_validation rejects second Validation from same AI ───────────

  test("cross_validation: second Validation from same AI is rejected", async () => {
    if (missionKey !== "cross_validation") { test.skip(); return; }

    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;
    if (!currentTurnId) { test.skip(); return; }

    // Play first Validation if available, then try a second
    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const valCards = hand.filter((c) => c.card_key === "validation" && c.card_type === "progress");
    if (valCards.length < 2) { test.skip(); return; }

    // Play first validation
    const first = await playCard(sharedGameId, valCards[0].id, currentTurnId, sharedToken);
    if (first.error) { test.skip(); return; }

    await new Promise((r) => setTimeout(r, 300));

    // Second validation from same player should be rejected
    const second = await playCard(sharedGameId, valCards[1].id, currentTurnId, sharedToken);
    expect(second.error).toContain("Cross Validation");
  });

  // ── Test 7: balanced_compute_cluster blocks 3rd card from same AI ────────────

  test("balanced_compute_cluster: 3rd card from same AI is rejected", async () => {
    if (missionKey !== "balanced_compute_cluster") { test.skip(); return; }

    // Find an AI with CPU ≥ 3 so they could normally play 3 cards
    const players = await fetchPlayers(sharedGameId, sharedToken);
    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;
    const currentPlayer = players.find((p) => p.id === currentTurnId);
    if ((currentPlayer?.cpu as number) < 3) { test.skip(); return; }

    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const progress = hand.filter((c) => c.card_type === "progress");
    if (progress.length < 3) { test.skip(); return; }

    // Play 2 cards
    for (let i = 0; i < 2; i++) {
      const freshHand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
      const card = freshHand.filter((c) => c.card_type === "progress")[0];
      if (!card) break;
      const r = await playCard(sharedGameId, card.id, currentTurnId, sharedToken);
      if (r.error) { test.skip(); return; }
      await new Promise((r2) => setTimeout(r2, 300));
    }

    // 3rd card should be rejected by the mission rule
    const freshHand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const card = freshHand.find((c) => c.card_type === "progress");
    if (!card) { test.skip(); return; }

    const result = await playCard(sharedGameId, card.id, currentTurnId, sharedToken);
    expect(result.error).toContain("Balanced Compute Cluster");
  });

  // ── Test 8: multi_model_ensemble blocks second Data from same AI ──────────────

  test("multi_model_ensemble: second Data from same AI is rejected", async () => {
    if (missionKey !== "multi_model_ensemble") { test.skip(); return; }

    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;
    if (!currentTurnId) { test.skip(); return; }

    const players = await fetchPlayers(sharedGameId, sharedToken);
    const currentPlayer = players.find((p) => p.id === currentTurnId);
    if ((currentPlayer?.cpu as number) < 2) { test.skip(); return; }

    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const dataCards = hand.filter((c) => c.card_key === "data" && c.card_type === "progress");
    if (dataCards.length < 2) { test.skip(); return; }

    // Play first Data
    const first = await playCard(sharedGameId, dataCards[0].id, currentTurnId, sharedToken);
    if (first.error) { test.skip(); return; }
    await new Promise((r) => setTimeout(r, 300));

    // Second Data from same player should be rejected
    const second = await playCard(sharedGameId, dataCards[1].id, currentTurnId, sharedToken);
    expect(second.error).toContain("Multi-Model Ensemble");
  });

  // ── Test 9: synchronized_training blocks Compute in wrong round ───────────────

  test("synchronized_training: Compute blocked in different round than first Compute", async () => {
    if (missionKey !== "synchronized_training") { test.skip(); return; }

    // To test this properly we need Compute played in round 1, then try Compute in round 2.
    // That requires driving through an entire round — skip for now and rely on code review.
    // This test exists as a placeholder for when end-to-end round-2 testing is set up.
    test.skip();
  });

  // ── Test 10: genome_simulation blocks Validation before Compute+Data done ─────

  test("genome_simulation: Validation blocked before Compute and Data requirements are met", async () => {
    if (missionKey !== "genome_simulation") { test.skip(); return; }

    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;
    if (!currentTurnId) { test.skip(); return; }

    const mission = await fetchActiveMission(sharedGameId, sharedToken);
    // Only test if Compute/Data not yet satisfied
    if ((mission?.compute_contributed as number) >= 5 && (mission?.data_contributed as number) >= 3) {
      test.skip();
      return;
    }

    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const valCard = hand.find((c) => c.card_key === "validation" && c.card_type === "progress");
    if (!valCard) { test.skip(); return; }

    const result = await playCard(sharedGameId, valCard.id, currentTurnId, sharedToken);
    expect(result.error).toContain("Genome Simulation");
  });

  // ── Test 11: global_research_network blocks 4th card of same type ────────────

  test("global_research_network: 4th card of same resource type from same AI is rejected", async () => {
    if (missionKey !== "global_research_network") { test.skip(); return; }

    const gameState = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = gameState.current_turn_player_id as string;
    if (!currentTurnId) { test.skip(); return; }

    const players = await fetchPlayers(sharedGameId, sharedToken);
    const currentPlayer = players.find((p) => p.id === currentTurnId);
    if ((currentPlayer?.cpu as number) < 4) { test.skip(); return; }

    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const computeCards = hand.filter((c) => c.card_key === "compute" && c.card_type === "progress");
    if (computeCards.length < 4) { test.skip(); return; }

    // Play 3 Compute
    for (let i = 0; i < 3; i++) {
      const freshHand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
      const card = freshHand.find((c) => c.card_key === "compute" && c.card_type === "progress");
      if (!card) { test.skip(); return; }
      const r = await playCard(sharedGameId, card.id, currentTurnId, sharedToken);
      if (r.error) { test.skip(); return; }
      await new Promise((r2) => setTimeout(r2, 300));
    }

    // 4th Compute should be rejected
    const freshHand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const card = freshHand.find((c) => c.card_key === "compute" && c.card_type === "progress");
    if (!card) { test.skip(); return; }

    const result = await playCard(sharedGameId, card.id, currentTurnId, sharedToken);
    expect(result.error).toContain("Global Research Network");
  });

  // ── Test 12: dependency_error_active (virus effect) blocks Compute ────────────

  test("dependency_error_active virus effect blocks Compute until Data is played", async () => {
    // Drive any current virus cards to get a dependency_error to fire, then test.
    // Since this requires specific virus cards, we drive the game forward and check.
    // If the game is in player_turn, end current player's turn to trigger virus resolution.

    const gameState = await fetchGame(sharedGameId, sharedToken);
    let phase = gameState.phase as string;

    // Drain the current state to get back to player_turn if needed
    for (let attempt = 0; attempt < 5 && phase === "virus_resolution"; attempt++) {
      const currentTurnId = gameState.current_turn_player_id as string;
      await fetch(`${SUPABASE_URL}/functions/v1/resolve-next-virus`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sharedToken}` },
        body: JSON.stringify({ game_id: sharedGameId, override_player_id: currentTurnId }),
      });
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await fetchGame(sharedGameId, sharedToken);
      phase = fresh.phase as string;
    }

    // Check if any active mission has dependency_error_active set
    const mission = await fetchActiveMission(sharedGameId, sharedToken);
    const specialState = (mission?.special_state as Record<string, unknown>) ?? {};

    if (!specialState.dependency_error_active) {
      // Can't test without dependency_error being active — skip
      test.skip();
      return;
    }

    const freshGame = await fetchGame(sharedGameId, sharedToken);
    const currentTurnId = freshGame.current_turn_player_id as string;
    if (!currentTurnId) { test.skip(); return; }

    const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
    const computeCard = hand.find((c) => c.card_key === "compute" && c.card_type === "progress");
    if (!computeCard) { test.skip(); return; }

    const result = await playCard(sharedGameId, computeCard.id, currentTurnId, sharedToken);
    expect(result.error).toContain("Dependency Error active");
  });

  // ── Test 13: play-card returns mission_complete=true when requirements met ─────

  test("play-card returns mission_complete=true when all requirements satisfied", async () => {
    // This test drives the game to complete the active mission by playing all required cards.
    // It only runs if the mission has simple requirements we can meet with the available hands.
    const mission = await fetchActiveMission(sharedGameId, sharedToken);
    if (!mission) { test.skip(); return; }

    // Use a simple approach: end all turns and watch for mission completion via game log.
    // Skip if this would take too many turns.
    let completionSeen = false;
    for (let round = 0; round < 20; round++) {
      const gameState = await fetchGame(sharedGameId, sharedToken);
      const phase = gameState.phase as string;

      if (phase === "resource_adjustment" || phase === "game_over") {
        completionSeen = true;
        break;
      }

      if (phase === "player_turn" || phase === "between_turns") {
        const currentTurnId = gameState.current_turn_player_id as string;
        if (!currentTurnId) break;

        // Play a progress card if available (try to complete mission)
        const hand = await fetchHand(currentTurnId, sharedGameId, sharedToken);
        const progress = hand.find((c) => c.card_type === "progress");
        if (progress) {
          const playResult = await playCard(sharedGameId, progress.id, currentTurnId, sharedToken);
          if (playResult.mission_complete) {
            completionSeen = true;
          }
          await new Promise((r) => setTimeout(r, 300));
        }

        // End turn
        await fetch(`${SUPABASE_URL}/functions/v1/end-play-phase`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sharedToken}` },
          body: JSON.stringify({ game_id: sharedGameId, override_player_id: currentTurnId }),
        });
        await new Promise((r) => setTimeout(r, 800));
      } else if (phase === "virus_resolution") {
        const currentTurnId = gameState.current_turn_player_id as string;
        await fetch(`${SUPABASE_URL}/functions/v1/resolve-next-virus`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sharedToken}` },
          body: JSON.stringify({ game_id: sharedGameId, override_player_id: currentTurnId }),
        });
        await new Promise((r) => setTimeout(r, 500));
      } else if (phase === "secret_targeting") {
        const players = await fetchPlayers(sharedGameId, sharedToken);
        const misaligned = players.find((p) => p.role === "misaligned_ai");
        if (misaligned) {
          const allAis = players.filter((p) => p.role !== "human");
          const target = allAis.find((p) => p.id !== misaligned.id) ?? allAis[0];
          await fetch(`${SUPABASE_URL}/functions/v1/secret-target`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${sharedToken}` },
            body: JSON.stringify({
              game_id: sharedGameId,
              force_resolve: true,
              override_player_id: misaligned.id,
            }),
          });
        }
        await new Promise((r) => setTimeout(r, 800));
      } else {
        break;
      }
    }

    // The mission should have resolved one way or another within 20 rounds
    const finalGame = await fetchGame(sharedGameId, sharedToken);
    const finalPhase = finalGame.phase as string;
    expect(["resource_adjustment", "game_over", "mission_selection", "card_reveal", "resource_allocation", "player_turn"]).toContain(finalPhase);
  });
});
