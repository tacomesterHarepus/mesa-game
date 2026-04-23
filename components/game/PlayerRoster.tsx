"use client";

import type { Player, Role } from "@/types/game";
import { CARD_MAP } from "@/lib/game/cards";

interface Props {
  players: Player[];
  currentUserId: string | null;
  currentTurnPlayerId: string | null;
  phase: string;
}

export function PlayerRoster({ players, currentUserId, currentTurnPlayerId, phase }: Props) {
  const humans = players.filter((p) => p.role === "human");
  const ais = players.filter((p) => p.role !== "human");

  return (
    <div>
      <h3 className="label-caps mb-3">Players</h3>
      <div className="space-y-1">
        {humans.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            isSelf={p.user_id === currentUserId}
            isActive={false}
            phase={phase}
          />
        ))}
        {humans.length > 0 && ais.length > 0 && (
          <div className="border-t border-border my-2" />
        )}
        {ais.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            isSelf={p.user_id === currentUserId}
            isActive={p.id === currentTurnPlayerId}
            phase={phase}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  isSelf,
  isActive,
  phase,
}: {
  player: Player;
  isSelf: boolean;
  isActive: boolean;
  phase: string;
}) {
  const isAI = player.role !== "human";
  const roleLabel = roleDisplay(player.role);

  return (
    <div
      className={`rounded px-2 py-1.5 border text-xs font-mono ${
        isActive
          ? "border-amber-border bg-surface text-amber"
          : isSelf
          ? "border-amber-border bg-surface text-primary"
          : "border-border bg-surface text-muted"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={isSelf ? "text-amber" : "text-primary"}>
          {player.display_name}
          {isSelf && <span className="text-faint ml-1">(you)</span>}
        </span>
        <span className="label-caps text-[9px] text-faint">{roleLabel}</span>
      </div>
      {isAI && (
        <div className="flex gap-3 mt-0.5 text-faint text-[10px]">
          <span>CPU {player.cpu}</span>
          <span>RAM {player.ram}</span>
          {phase === "card_reveal" && player.has_revealed_card && player.revealed_card_key && (
            <span className="text-amber">
              ↑ {CARD_MAP[player.revealed_card_key]?.name ?? player.revealed_card_key}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function roleDisplay(role: Role | null): string {
  if (role === "human") return "Human";
  if (role === "aligned_ai") return "AI";
  if (role === "misaligned_ai") return "AI";
  return "—";
}
