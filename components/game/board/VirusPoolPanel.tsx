interface Props {
  poolCount: number;
  pendingPullCount?: number;
  phase: string;
}

export function VirusPoolPanel({ poolCount, pendingPullCount, phase }: Props) {
  const cardLabel = poolCount === 1 ? "CARD" : "CARDS";
  const headerText =
    phase === "virus_pull" && pendingPullCount !== undefined && pendingPullCount > 0
      ? `VIRUS POOL · ${poolCount} ${cardLabel} · ${pendingPullCount} TO DRAW`
      : `VIRUS POOL · ${poolCount} ${cardLabel}`;

  return (
    <div
      style={{
        position: "absolute",
        left: 32,
        top: 395,
        width: 348,
        height: 170,
        background: "#0c0c0c",
        border: "1px solid #222",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* Header strip */}
      <div
        style={{
          height: 22,
          background: "#1a0a0a",
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
        }}
      >
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "#9a5a5a",
            letterSpacing: 2,
          }}
        >
          {headerText}
        </span>
      </div>

      {/* Body */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 32,
          padding: "24px 28px",
        }}
      >
        {/* 4 stacked face-down virus cards (visual decoration) */}
        <div style={{ position: "relative", width: 58, height: 72 }}>
          {[3, 2, 1, 0].map((offset) => (
            <div
              key={offset}
              style={{
                position: "absolute",
                left: offset * 3,
                top: -(offset * 2),
                width: 40,
                height: 56,
                background: "#2a1010",
                border: "1px solid #5a3a3a",
                borderRadius: 3,
              }}
            />
          ))}
        </div>

        {/* Count label */}
        <div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 26,
              color: "#a32d2d",
              lineHeight: 1,
              marginBottom: 6,
            }}
          >
            ×{poolCount}
          </div>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: 9,
              color: "#5a3a3a",
              letterSpacing: 1,
            }}
          >
            CARDS READY
          </div>
        </div>
      </div>
    </div>
  );
}
