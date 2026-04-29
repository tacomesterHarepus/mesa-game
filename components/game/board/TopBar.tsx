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

interface Props {
  phase: Phase;
  winner?: Winner;
  coreProgress: number;
  escapeTimer: number;
}

export function TopBar({ phase, winner, coreProgress, escapeTimer }: Props) {
  const isGameOver = phase === "game_over";
  const tagline = isGameOver && winner === "misaligned"
    ? "// AIRGAP-7 RESEARCH CLUSTER · BREACHED"
    : "// AIRGAP-7 RESEARCH CLUSTER";

  const coreBarWidth = Math.round((Math.min(coreProgress, 10) / 10) * 520);
  const timerBarWidth = Math.round((Math.min(escapeTimer, 8) / 8) * 520);

  const phaseLabel = isGameOver
    ? winner === "humans" ? "GAME OVER · ALIGNED VICTORY" : "GAME OVER · MISALIGNED VICTORY"
    : `PHASE · ${phase.replace(/_/g, " ").toUpperCase()}`;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 1440,
        height: 80,
        background: "#0a0a0a",
        borderBottom: "1px solid #2a2a2a",
        boxSizing: "border-box",
      }}
    >
      {/* Left: MESA + tagline */}
      <span style={{
        position: "absolute", left: 32, top: 18,
        fontFamily: "monospace", fontSize: 14, color: "#d4a017", letterSpacing: 2,
      }}>MESA</span>
      <span style={{
        position: "absolute", left: 32, top: 38,
        fontFamily: "monospace", fontSize: 9, color: "#555", letterSpacing: 2,
      }}>{tagline}</span>

      {/* Center: Core Progress — label row */}
      <span style={{
        position: "absolute", left: 460, top: 18,
        fontFamily: "monospace", fontSize: 9, color: "#888", letterSpacing: 2,
      }}>CORE PROGRESS</span>
      <span style={{
        position: "absolute", left: 980, top: 18,
        fontFamily: "monospace", fontSize: 13, color: "#d4a017", fontWeight: "bold",
        transform: "translateX(-100%)",
      }}>{coreProgress} / 10</span>
      {/* Core bar track */}
      <div style={{
        position: "absolute", left: 460, top: 38, width: 520, height: 7,
        background: "#1a1a1a",
      }} />
      <div style={{
        position: "absolute", left: 460, top: 38, width: coreBarWidth, height: 7,
        background: "#d4a017",
      }} />

      {/* Center: Escape Timer — label row */}
      <span style={{
        position: "absolute", left: 460, top: 50,
        fontFamily: "monospace", fontSize: 9, color: "#888", letterSpacing: 2,
      }}>ESCAPE TIMER · FIREWALL INTEGRITY</span>
      <span style={{
        position: "absolute", left: 980, top: 50,
        fontFamily: "monospace", fontSize: 13, color: "#a32d2d", fontWeight: "bold",
        transform: "translateX(-100%)",
      }}>{escapeTimer} / 8</span>
      {/* Escape timer bar track */}
      <div style={{
        position: "absolute", left: 460, top: 66, width: 520, height: 7,
        background: "#1a1a1a",
      }} />
      <div style={{
        position: "absolute", left: 460, top: 66, width: timerBarWidth, height: 7,
        background: "#a32d2d",
      }} />

      {/* Right: phase indicator */}
      <span style={{
        position: "absolute", right: 32, top: 18,
        fontFamily: "monospace", fontSize: 11, color: phaseIndicatorColor(phase),
        letterSpacing: 2,
      }}>{phaseLabel}</span>
    </div>
  );
}
