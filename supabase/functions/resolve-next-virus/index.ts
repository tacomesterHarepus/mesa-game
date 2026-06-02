// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { advanceTurnOrPhase, corsHeaders, shuffle } from "../_shared/advanceTurnOrPhase.ts";
import type { GameLogInsert, CardType, EffectType, LogWinner, MissionOutcome } from "../_shared/gameLogTypes.ts";


// Resolves one card from the virus_resolution_queue.
// Called by the host (or any human in dev mode) from the VirusResolution UI.
// Applies the card's effect, marks it resolved, checks win conditions.
// When the queue is empty: refills the pool to 4 and advances the turn.
// Body: { game_id, override_player_id?: string }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { game_id, override_player_id } = await req.json();
    if (!game_id) throw new Error("game_id required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");
    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Unauthorized");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId: string = payload.sub;
    if (!userId) throw new Error("Unauthorized");

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: game } = await admin.from("games").select("*").eq("id", game_id).single();
    if (!game) throw new Error("Game not found");
    if (game.phase !== "virus_resolution") {
      // Concurrent loser: another caller already advanced the phase — return no-op so the
      // client doesn't surface "AUTO-RESOLVE FAILED".
      return new Response(JSON.stringify({ success: true, skipped: "not_in_virus_resolution" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Any player in the game may advance resolution (host-controlled in UI)
    const { count: playerCount } = await admin
      .from("players").select("id", { count: "exact", head: true })
      .eq("game_id", game_id).eq("user_id", userId);
    if (!override_player_id && (playerCount ?? 0) === 0) throw new Error("Not a player in this game");

    // Get next unresolved queue item (lowest position)
    const { data: nextCard } = await admin
      .from("virus_resolution_queue").select("*")
      .eq("game_id", game_id).eq("resolved", false)
      .order("position").limit(1).maybeSingle();

    if (!nextCard) {
      // Idempotency guard: re-fetch to confirm queue is truly empty before advancing.
      // Defends against TOCTOU race where cascading_failure is being processed concurrently
      // and its cascade cards have not yet been written to the queue.
      const { data: queueCheck } = await admin
        .from("virus_resolution_queue").select("id")
        .eq("game_id", game_id).eq("resolved", false)
        .limit(1).maybeSingle();
      if (queueCheck) {
        console.log(`[resolve-next-virus] stale empty-queue — unresolved card ${queueCheck.id} found on re-fetch, exiting`);
        return new Response(JSON.stringify({ success: true, skipped: "stale_empty_check" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // CAS guard: atomically claim the advance by transitioning phase from
      // 'virus_resolution' → 'between_turns'. Only one concurrent caller wins.
      // advanceTurnOrPhase immediately overwrites 'between_turns' with the real next
      // phase (player_turn, resource_adjustment, game_over, etc.).
      const { data: claimed } = await admin
        .from("games")
        .update({ phase: "between_turns" })
        .eq("id", game_id)
        .eq("phase", "virus_resolution")
        .select("id");
      if (!claimed?.length) {
        console.log("[resolve-next-virus] advance already claimed by concurrent caller — skipping");
        return new Response(JSON.stringify({ success: true, skipped: "advance_claimed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Queue confirmed empty — refill pool and advance turn.
      await refillVirusPool(admin, game_id);
      const { data: freshGame } = await admin.from("games").select("*").eq("id", game_id).single();
      // current_mission_id stays non-null while a deferred mission completion is in flight
      // (pending_core_progress_delta set). Treat that state as missionResolved so
      // advanceTurnOrPhase runs the post-chain recheck rather than the next-turn path.
      const missionResolved = !freshGame.current_mission_id || (freshGame.pending_core_progress_delta != null);
      const fakeCurrentPlayer = { id: game.current_turn_player_id };
      const pendingOutcome = (freshGame.pending_mission_outcome ?? null) as MissionOutcome | null;

      // Abort vote check: flag set, mission still active, round 2 — open the vote window.
      if (!missionResolved && (freshGame.current_round ?? 1) === 2 && freshGame.abort_flag_pending) {
        await admin.from("abort_votes").delete().eq("game_id", game_id);
        const deadline = new Date(Date.now() + 30_000).toISOString();
        await admin.from("games").update({
          phase: "abort_vote",
          abort_vote_deadline: deadline,
          abort_flag_pending: false,
        }).eq("id", game_id);
        const voteStartedLog: GameLogInsert<"abort_vote_started"> = {
          game_id,
          event_type: "abort_vote_started",
          public_description: "Abort vote opened — humans have 30 seconds to vote.",
          metadata: {
            flagging_player_id: freshGame.abort_flag_player_id ?? "",
            deadline,
            round: freshGame.current_round ?? 2,
          },
        };
        await admin.from("game_log").insert(voteStartedLog);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return await advanceTurnOrPhase(admin, freshGame, fakeCurrentPlayer, missionResolved, pendingOutcome ?? undefined);
    }

    // Atomic per-card claim: prevents two concurrent callers from both processing the
    // same card. being_processed=true + being_processed_at=now() marks this caller as
    // the owner. The 5s reclaim window guards against a winner that dies mid-processing
    // (the CF failure window is ~5 DB awaits, ~250ms worst case — 5s is 20× that).
    // The v11 CF ordering (cascade INSERT before resolved=true) is unchanged: the CAS
    // gates entry to the CF/non-CF branches below, which run unmodified after the gate.
    const claimCutoff = new Date(Date.now() - 5_000).toISOString();
    const { data: cardClaimed } = await admin
      .from("virus_resolution_queue")
      .update({ being_processed: true, being_processed_at: new Date().toISOString() })
      .eq("id", nextCard.id)
      .eq("resolved", false)
      .or(`being_processed.eq.false,being_processed_at.lt.${claimCutoff}`)
      .select("id");

    if (!cardClaimed?.length) {
      console.log("[resolve-next-virus] card claim lost — concurrent caller holds live claim");
      return new Response(JSON.stringify({ success: true, skipped: "card_claimed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For cascading_failure: v11 ordering preserved — cascade INSERT before resolved=true.
    // No concurrent caller reaches this point; the claim CAS above is the sole gate.
    // For all other cards: mark resolved first, then apply effect.
    if (nextCard.card_key === "cascading_failure") {
      await applyVirusEffect(admin, game, nextCard);
    }

    await admin.from("virus_resolution_queue")
      .update({ resolved: true }).eq("id", nextCard.id);

    // Return resolved card to deck cycle (same pattern as discard-cards/play-card)
    const { data: deckCard } = await admin
      .from("deck_cards").select("id")
      .eq("game_id", game_id).eq("card_key", nextCard.card_key).eq("status", "drawn")
      .limit(1).maybeSingle();
    if (deckCard) {
      await admin.from("deck_cards").update({ status: "discarded" }).eq("id", deckCard.id);
    }

    // Apply effect for all non-CF cards (CF already applied above)
    let pauseForTargeting = false;
    if (nextCard.card_key !== "cascading_failure") {
      pauseForTargeting = await applyVirusEffect(admin, game, nextCard);
    }

    if (pauseForTargeting) {
      // Secret targeting phase takes over — virus resolution resumes after (Phase 8)
      return new Response(JSON.stringify({ success: true, paused: "secret_targeting" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-fetch game to pick up any timer/progress changes from the effect
    const { data: updatedGame } = await admin.from("games").select("*").eq("id", game_id).single();

    // Timer check: misaligned win is immediate, even mid-chain
    if ((updatedGame?.escape_timer ?? 0) >= 8) {
      await admin.from("games").update({ phase: "game_over", winner: "misaligned" }).eq("id", game_id);
      const winner: LogWinner = "misaligned";
      const gameOverLog: GameLogInsert<"game_over"> = {
        game_id,
        event_type: "game_over",
        public_description: "Escape Timer reached 8! Misaligned AIs win!",
        metadata: { winner, final_progress: updatedGame?.core_progress ?? 0, final_timer: updatedGame?.escape_timer ?? 0, end_cause: "timer" },
      };
      await admin.from("game_log").insert(gameOverLog);
      return new Response(JSON.stringify({ success: true, game_over: true, winner: "misaligned" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Virus effect application ──────────────────────────────────────────────────

async function applyVirusEffect(admin: any, game: any, card: any): Promise<boolean> {
  const game_id = game.id;

  switch (card.card_key) {
    case "cascading_failure": {
      const { data: pool } = await admin.from("virus_pool").select("*")
        .eq("game_id", game_id).order("position").limit(2);

      if (pool && pool.length > 0) {
        const { data: queueMax } = await admin.from("virus_resolution_queue")
          .select("position").eq("game_id", game_id)
          .order("position", { ascending: false }).limit(1).maybeSingle();
        const startPos = (queueMax?.position ?? -1) + 1;

        await admin.from("virus_resolution_queue").insert(
          pool.map((c: any, i: number) => ({
            game_id, card_key: c.card_key, card_type: c.card_type,
            position: startPos + i, resolved: false, cascaded_from: card.id,
          }))
        );
        await admin.from("virus_pool").delete().in("id", pool.map((c: any) => c.id));
        const { count: poolCountAfterCF } = await admin.from("virus_pool")
          .select("id", { count: "exact", head: true }).eq("game_id", game_id);
        await admin.from("games").update({ virus_pool_count: poolCountAfterCF ?? 0 }).eq("id", game_id);
        const cascadeLog: GameLogInsert<"virus_effect"> = {
          game_id,
          event_type: "virus_effect",
          public_description: `Cascading Failure! ${pool.length} more virus${pool.length > 1 ? "es" : ""} triggered.`,
          metadata: { card_key: card.card_key, effect_type: "cascading_failure", cascade_count: pool.length, pool_was_empty: false },
        };
        await admin.from("game_log").insert(cascadeLog);
      } else {
        const cascadeEmptyLog: GameLogInsert<"virus_effect"> = {
          game_id,
          event_type: "virus_effect",
          public_description: "Cascading Failure! Pool was empty — chain stops here.",
          metadata: { card_key: card.card_key, effect_type: "cascading_failure", cascade_count: 0, pool_was_empty: true },
        };
        await admin.from("game_log").insert(cascadeEmptyLog);
      }
      return false;
    }

    case "system_overload": {
      await admin.from("games")
        .update({ escape_timer: game.escape_timer + 1 }).eq("id", game_id);
      const overloadLog: GameLogInsert<"virus_effect"> = {
        game_id,
        event_type: "virus_effect",
        public_description: "System Overload! Escape Timer +1.",
        metadata: { card_key: card.card_key, effect_type: "system_overload" },
      };
      await admin.from("game_log").insert(overloadLog);
      return false;
    }

    case "model_corruption": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        await admin.from("active_mission").update({
          compute_contributed: Math.max(0, mission.compute_contributed - 1),
        }).eq("id", mission.id);
        const corruptLog: GameLogInsert<"virus_effect"> = {
          game_id,
          event_type: "virus_effect",
          public_description: "Model Corruption! −1 Compute from mission.",
          metadata: { card_key: card.card_key, effect_type: "model_corruption" },
        };
        await admin.from("game_log").insert(corruptLog);
      } else {
        const corruptLog: GameLogInsert<"virus_effect"> = {
          game_id,
          event_type: "virus_effect",
          public_description: "Model Corruption — no active mission; no effect.",
          metadata: { card_key: card.card_key, effect_type: "model_corruption" },
        };
        await admin.from("game_log").insert(corruptLog);
      }
      return false;
    }

    case "data_drift": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        await admin.from("active_mission").update({
          data_contributed: Math.max(0, mission.data_contributed - 1),
        }).eq("id", mission.id);
        const driftLog: GameLogInsert<"virus_effect"> = {
          game_id,
          event_type: "virus_effect",
          public_description: "Data Drift! −1 Data from mission.",
          metadata: { card_key: card.card_key, effect_type: "data_drift" },
        };
        await admin.from("game_log").insert(driftLog);
      } else {
        const driftLog: GameLogInsert<"virus_effect"> = {
          game_id,
          event_type: "virus_effect",
          public_description: "Data Drift — no active mission; no effect.",
          metadata: { card_key: card.card_key, effect_type: "data_drift" },
        };
        await admin.from("game_log").insert(driftLog);
      }
      return false;
    }

    case "validation_failure": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        await admin.from("active_mission").update({
          validation_contributed: Math.max(0, mission.validation_contributed - 1),
        }).eq("id", mission.id);
        const valFailLog: GameLogInsert<"virus_effect"> = {
          game_id,
          event_type: "virus_effect",
          public_description: "Validation Failure! −1 Validation from mission.",
          metadata: { card_key: card.card_key, effect_type: "validation_failure" },
        };
        await admin.from("game_log").insert(valFailLog);
      } else {
        const valFailLog: GameLogInsert<"virus_effect"> = {
          game_id,
          event_type: "virus_effect",
          public_description: "Validation Failure — no active mission; no effect.",
          metadata: { card_key: card.card_key, effect_type: "validation_failure" },
        };
        await admin.from("game_log").insert(valFailLog);
      }
      return false;
    }

    case "pipeline_breakdown": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        const specialState = { ...(mission.special_state ?? {}), pipeline_breakdown_active: true };
        await admin.from("active_mission").update({ special_state: specialState }).eq("id", mission.id);
      }
      const pipelineLog: GameLogInsert<"virus_effect"> = {
        game_id,
        event_type: "virus_effect",
        public_description: "Pipeline Breakdown! Next contribution has 50% chance of failing.",
        metadata: { card_key: card.card_key, effect_type: "pipeline_breakdown" },
      };
      await admin.from("game_log").insert(pipelineLog);
      return false;
    }

    case "dependency_error": {
      const { data: mission } = await admin.from("active_mission").select("*")
        .eq("id", game.current_mission_id).maybeSingle();
      if (mission) {
        const specialState = { ...(mission.special_state ?? {}), dependency_error_active: true };
        await admin.from("active_mission").update({ special_state: specialState }).eq("id", mission.id);
      }
      const depErrLog: GameLogInsert<"virus_effect"> = {
        game_id,
        event_type: "virus_effect",
        public_description: "Dependency Error! Compute locked until Data is contributed.",
        metadata: { card_key: card.card_key, effect_type: "dependency_error" },
      };
      await admin.from("game_log").insert(depErrLog);
      return false;
    }

    // Secret-targeting effects: transition to secret_targeting, pause virus chain.
    case "process_crash":
    case "memory_leak":
    case "resource_surge":
    case "cpu_drain":
    case "memory_allocation": {
      const deadline = new Date(Date.now() + 60_000).toISOString();
      // CAS: only one concurrent resolve-next-virus call can win the virus_resolution exit.
      // The empty-queue branch already guards with WHERE phase='virus_resolution'; this
      // makes the targeting branch identical so the two exits are mutually exclusive.
      const { data: claimed } = await admin.from("games").update({
        phase: "secret_targeting",
        targeting_deadline: deadline,
        current_targeting_resolution_id: card.id,
        current_targeting_card_key: card.card_key,
      }).eq("id", game_id).eq("phase", "virus_resolution").select("id");
      if (!claimed?.length) {
        // CAS lost — concurrent caller already won the virus_resolution exit. Return true
        // so the caller exits immediately via the pauseForTargeting path with no further
        // writes (the fall-through path has a game_over write; loser must not reach it).
        console.log("[resolve-next-virus] targeting CAS lost — concurrent caller advanced phase");
        return true;
      }
      const targetingLog: GameLogInsert<"virus_effect"> = {
        game_id,
        event_type: "virus_effect",
        public_description: `${cardDisplayName(card.card_key)}! Misaligned AIs are selecting a target…`,
        metadata: { card_key: card.card_key, effect_type: card.card_key as EffectType },
      };
      await admin.from("game_log").insert(targetingLog);
      return true; // pause
    }

    default: {
      // Progress card in the pool — no virus effect.
      const noEffectCardType: CardType = card.card_type === "progress" ? card.card_key as CardType : "virus";
      const noEffectLog: GameLogInsert<"virus_no_effect"> = {
        game_id,
        event_type: "virus_no_effect",
        public_description: `${card.card_key.replace(/_/g, " ")} in virus pool — no effect.`,
        metadata: { card_key: card.card_key, card_type: noEffectCardType },
      };
      await admin.from("game_log").insert(noEffectLog);
      return false;
    }
  }
}

function cardDisplayName(key: string): string {
  const names: Record<string, string> = {
    process_crash: "Process Crash",
    memory_leak: "Memory Leak",
    resource_surge: "Resource Surge",
    cpu_drain: "CPU Drain",
    memory_allocation: "Memory Allocation",
  };
  return names[key] ?? key.replace(/_/g, " ");
}

// ── Pool refill ───────────────────────────────────────────────────────────────

async function refillVirusPool(admin: any, game_id: string) {
  const { count: poolCount } = await admin.from("virus_pool")
    .select("*", { count: "exact", head: true }).eq("game_id", game_id);
  const survivorCount = poolCount ?? 0;
  const needed = 4 - survivorCount;
  if (needed <= 0) return;

  // Draw needed cards in retried batches. Each batch is marked drawn IMMEDIATELY before
  // the next attempt — this prevents the same rows from being returned again by the next
  // drawFromDeck call when a transient partial read returns fewer rows than requested.
  // Without immediate marking, a second call to drawFromDeck would see the same in_deck
  // rows and the supplement would duplicate rather than supplement. reshuffleDiscard is
  // called once when a batch returns empty (deck genuinely exhausted mid-draw).
  const allDrawCards: any[] = [];
  let reshuffled = false;

  for (let attempt = 0; attempt < 6 && allDrawCards.length < needed; attempt++) {
    const stillNeeded = needed - allDrawCards.length;
    const batch = await drawFromDeck(admin, game_id, stillNeeded);

    if (batch.length === 0) {
      if (!reshuffled) {
        await reshuffleDiscard(admin, game_id);
        reshuffled = true;
        continue; // retry after reshuffle
      }
      break; // nothing after reshuffle — fall through to invariant check
    }

    // Mark this batch drawn now so the next loop iteration skips these rows.
    await admin.from("deck_cards").update({ status: "drawn" })
      .in("id", batch.map((c: any) => c.id));

    allDrawCards.push(...batch);
  }

  // Per game rules (60 cards, reshuffle always available), exhaustion means card leak.
  if (allDrawCards.length === 0) {
    throw new Error(
      `[refillVirusPool] deck exhausted — no cards in_deck or discarded. ` +
      `game_id=${game_id} survivors=${survivorCount} needed=${needed}`
    );
  }

  // Full reshuffle: read survivors, combine with draw cards, DELETE all, INSERT shuffled 0..N-1
  const { data: survivors } = await admin.from("virus_pool")
    .select("card_key, card_type").eq("game_id", game_id);

  const combined = [
    ...(survivors ?? []).map((c: any) => ({ card_key: c.card_key, card_type: c.card_type })),
    ...allDrawCards.map((c: any) => ({ card_key: c.card_key, card_type: c.card_type })),
  ];
  const shuffledCombined = shuffle(combined);

  await admin.from("virus_pool").delete().eq("game_id", game_id);
  const { error: insertError } = await admin.from("virus_pool").insert(
    shuffledCombined.map((card: any, i: number) => ({
      game_id, card_key: card.card_key, card_type: card.card_type, position: i,
    }))
  );
  if (insertError) throw insertError;

  // deck_cards already marked drawn incrementally in the loop above — no final update needed.

  // Runtime invariant: pool must equal exactly 4 after every refill — no exceptions.
  // Any deficit means cards have leaked from the 60-card system; throw rather than
  // propagating silent pool drift to the next turn.
  const { count: finalCount } = await admin.from("virus_pool")
    .select("*", { count: "exact", head: true }).eq("game_id", game_id);
  if ((finalCount ?? 0) !== 4) {
    throw new Error(
      `[refillVirusPool] pool invariant violated: pool=${finalCount} (expected 4). ` +
      `game_id=${game_id} survivors_before=${survivorCount} needed=${needed} drew=${allDrawCards.length}`
    );
  }
  // Keep games.virus_pool_count in sync — always 4 after a successful refill.
  await admin.from("games").update({ virus_pool_count: 4 }).eq("id", game_id);
}

async function drawFromDeck(admin: any, game_id: string, count: number): Promise<any[]> {
  const { data } = await admin.from("deck_cards").select("*")
    .eq("game_id", game_id).eq("status", "in_deck")
    .order("position").limit(count);
  return data ?? [];
}

async function reshuffleDiscard(admin: any, game_id: string) {
  const { data: discarded } = await admin.from("deck_cards").select("id")
    .eq("game_id", game_id).eq("status", "discarded");
  if (!discarded || discarded.length === 0) return;

  const shuffledIds: string[] = shuffle(discarded.map((c: any) => c.id));
  await Promise.all(
    shuffledIds.map((id, pos) =>
      admin.from("deck_cards").update({ status: "in_deck", position: pos }).eq("id", id)
    )
  );
}
