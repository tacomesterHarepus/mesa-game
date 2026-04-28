import type { Phase, Winner } from "@/types/game";

function phaseIndicatorColor(phase: Phase): string {
  switch (phase) {
    case "player_turn":
    case "between_turns":
    case "mission_resolution":
      return "#d4a017";
    case "card_reveal":
      return "#5dcaa5";
    case "virus_resolution":
    case "secret_targeting":
    case "game_over":
      return "#a32d2d";
    default:
      return "#555";
  }
}

export function TopBar({ phase, winner }: { phase: Phase; winner?: Winner }) {
  const isGameOver = phase === "game_over";
  const tagline = isGameOver && winner === "misaligned"
    ? "// AIRGAP-7 RESEARCH CLUSTER · BREACHED"
    : "// AIRGAP-7 RESEARCH CLUSTER";
  const rightText = isGameOver
    ? winner === "humans"
      ? "GAME OVER · ALIGNED VICTORY"
      : "GAME OVER · MISALIGNED VICTORY"
    : "M? · ?";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: 60,
        background: "#0c0c0c",
        borderBottom: "1px solid #1a1a1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 32px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 14,
            color: "#d4a017",
            letterSpacing: 3,
          }}
        >
          MESA
        </span>
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "#555",
            letterSpacing: 2,
          }}
        >
          {tagline}
        </span>
      </div>
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          color: phaseIndicatorColor(phase),
          letterSpacing: 1,
        }}
      >
        {rightText}
      </span>
    </div>
  );
}
