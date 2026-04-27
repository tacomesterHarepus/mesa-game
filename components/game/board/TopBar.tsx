import type { Phase } from "@/types/game";

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

export function TopBar({ phase }: { phase: Phase }) {
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
          {"// AIRGAP-7 RESEARCH CLUSTER"}
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
        M? · ?
      </span>
    </div>
  );
}
