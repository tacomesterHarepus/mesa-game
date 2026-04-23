"use client";

interface Props {
  coreProgress: number;
  escapeTimer: number;
}

const PROGRESS_MAX = 10;
const TIMER_MAX = 8;

export function TrackerBar({ coreProgress, escapeTimer }: Props) {
  const progressPct = Math.min(100, (coreProgress / PROGRESS_MAX) * 100);
  const timerPct = Math.min(100, (escapeTimer / TIMER_MAX) * 100);

  return (
    <div className="border-b border-border px-6 py-3 flex gap-6 items-center bg-base">
      {/* Core Progress */}
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-1">
          <span className="label-caps text-[10px]">Core Progress</span>
          <span className="font-mono text-xs text-amber">
            {coreProgress} / {PROGRESS_MAX}
          </span>
        </div>
        <div className="h-2 bg-surface rounded overflow-hidden border border-border">
          <div
            className="h-full bg-amber transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Escape Timer */}
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-1">
          <span className="label-caps text-[10px]">Escape Timer</span>
          <span className={`font-mono text-xs ${escapeTimer >= 6 ? "text-virus" : "text-muted"}`}>
            {escapeTimer} / {TIMER_MAX}
          </span>
        </div>
        <div className="h-2 bg-surface rounded overflow-hidden border border-border">
          <div
            className={`h-full transition-all duration-500 ${
              escapeTimer >= 6 ? "bg-virus" : escapeTimer >= 4 ? "bg-amber" : "bg-muted"
            }`}
            style={{ width: `${timerPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
