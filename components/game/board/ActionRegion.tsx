import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  phase?: string;
  isActivePlayer?: boolean;
  currentTurnPlayerName?: string;
}

export function ActionRegion({ children, phase, isActivePlayer, currentTurnPlayerName }: Props) {
  const isActionPhase = phase === "player_turn" || phase === "between_turns";
  const showAmber = isActionPhase && isActivePlayer;

  const border = showAmber ? "2px solid #d4a017" : "1px solid #3a3a3a";
  const background = showAmber ? "#1a1810" : "#0c0c0c";

  const headerText = showAmber
    ? "▸ YOUR ACTION REQUIRED · YOUR TURN"
    : isActionPhase && currentTurnPlayerName
    ? `// ${currentTurnPlayerName}'s TURN`
    : null;

  const headerColor = showAmber ? "#d4a017" : "#555";

  return (
    <div
      style={{
        position: "absolute",
        left: 20,
        top: 688,
        width: 1064,
        height: 200,
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
