import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  phase?: string;
  isActivePlayer?: boolean;
  currentTurnPlayerName?: string;
}

export function ActionRegion({ children, phase, isActivePlayer, currentTurnPlayerName }: Props) {
  const isActionPhase =
    phase === "player_turn" ||
    phase === "between_turns" ||
    phase === "virus_pull" ||
    phase === "mission_selection" ||
    phase === "resource_adjustment" ||
    phase === "resource_allocation" ||
    phase === "card_reveal" ||
    phase === "secret_targeting";
  const showAmber = isActionPhase && isActivePlayer;

  const border = showAmber ? "2px solid #d4a017" : "1px solid #3a3a3a";
  const background = showAmber ? "#1a1810" : "#0c0c0c";

  const headerText =
    phase === "mission_selection"
      ? isActivePlayer
        ? "▸ YOUR ACTION REQUIRED · SELECT MISSION"
        : "// HUMANS CHOOSING MISSION"
      : phase === "resource_adjustment"
      ? isActivePlayer
        ? "▸ YOUR ACTION REQUIRED · ADJUST RESOURCES"
        : "// HUMANS ADJUSTING RESOURCES"
      : phase === "resource_allocation"
      ? isActivePlayer
        ? "▸ YOUR ACTION REQUIRED · ALLOCATE RESOURCES"
        : "// HUMANS ALLOCATING RESOURCES"
      : phase === "card_reveal"
      ? isActivePlayer
        ? "▸ YOUR ACTION REQUIRED · REVEAL ONE CARD"
        : "// AIs REVEALING CARDS"
      : phase === "virus_pull"
      ? isActivePlayer
        ? "▸ YOUR ACTION REQUIRED · PULL FROM VIRUS POOL"
        : `// WAITING — ${currentTurnPlayerName ?? "ACTIVE AI"} PULLING`
      : phase === "virus_resolution"
      ? "// AUTO-RESOLVING · NO ACTION NEEDED"
      : phase === "secret_targeting"
      ? isActivePlayer
        ? "▸ YOUR ACTION REQUIRED · NOMINATE A TARGET"
        : "// MISALIGNED AIs ARE TARGETING…"
      : phase === "game_over"
      ? "PHASE · GAME OVER"
      : showAmber
      ? "▸ YOUR ACTION REQUIRED · YOUR TURN"
      : isActionPhase && currentTurnPlayerName
      ? `// ${currentTurnPlayerName}'s TURN`
      : null;

  const headerColor =
    showAmber ? "#d4a017" :
    (phase === "virus_resolution" || phase === "secret_targeting" || phase === "game_over") ? "#a32d2d" :
    "#555";

  return (
    <div
      style={{
        position: "absolute",
        left: 20,
        top: 618,
        width: 1064,
        height: 270,
        background,
        border,
        borderRadius: 2,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {headerText && (
        <div
          style={{
            height: 30,
            minHeight: 30,
            display: "flex",
            alignItems: "center",
            paddingLeft: 16,
            fontFamily: "monospace",
            fontSize: 10,
            letterSpacing: 2,
            color: headerColor,
            borderBottom: showAmber ? "1px solid #3a2e1a" : "1px solid #1a1a1a",
          }}
        >
          {headerText}
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto" }}>{children}</div>
    </div>
  );
}
