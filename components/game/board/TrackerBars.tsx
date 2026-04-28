const PROGRESS_MAX = 10;
const TIMER_MAX = 8;
const BAR_WIDTH = 348;

interface Props {
  coreProgress: number;
  escapeTimer: number;
}

export function TrackerBars({ coreProgress, escapeTimer }: Props) {
  const progressFill = Math.round(
    (Math.min(coreProgress, PROGRESS_MAX) / PROGRESS_MAX) * BAR_WIDTH
  );
  const timerFill = Math.round(
    (Math.min(escapeTimer, TIMER_MAX) / TIMER_MAX) * BAR_WIDTH
  );

  return (
    <>
      {/* Core Progress */}
      <div
        style={{
          position: "absolute",
          top: 78,
          left: 32,
          width: BAR_WIDTH,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 10,
              color: "#555",
              letterSpacing: 2,
            }}
          >
            Core Progress
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: "bold", color: "#d4a017" }}>
            {coreProgress} / {PROGRESS_MAX}
          </span>
        </div>
        <div style={{ width: BAR_WIDTH, height: 8, background: "#1a1a1a" }}>
          <div style={{ width: progressFill, height: 8, background: "#d4a017" }} />
        </div>
      </div>

      {/* Escape Timer */}
      <div
        style={{
          position: "absolute",
          top: 119,
          left: 32,
          width: BAR_WIDTH,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 10,
              color: "#555",
              letterSpacing: 2,
            }}
          >
            Escape Timer · Firewall Integrity
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: "bold", color: "#a32d2d" }}>
            {escapeTimer} / {TIMER_MAX}
          </span>
        </div>
        <div style={{ width: BAR_WIDTH, height: 8, background: "#1a1a1a" }}>
          <div style={{ width: timerFill, height: 8, background: "#a32d2d" }} />
        </div>
      </div>
    </>
  );
}
