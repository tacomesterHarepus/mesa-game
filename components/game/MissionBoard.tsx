"use client";

import { MISSION_MAP } from "@/lib/game/missions";

interface ActiveMission {
  id: string;
  mission_key: string;
  compute_contributed: number;
  data_contributed: number;
  validation_contributed: number;
  round: number;
}

interface Props {
  mission: ActiveMission | null;
}

export function MissionBoard({ mission }: Props) {
  if (!mission) {
    return (
      <div className="text-faint text-xs font-mono">
        No active mission.
      </div>
    );
  }

  const def = MISSION_MAP[mission.mission_key];
  if (!def) return null;

  const reqs = [
    { label: "Compute", contributed: mission.compute_contributed, required: def.requirements.compute ?? 0 },
    { label: "Data", contributed: mission.data_contributed, required: def.requirements.data ?? 0 },
    { label: "Validation", contributed: mission.validation_contributed, required: def.requirements.validation ?? 0 },
  ].filter((r) => r.required > 0);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <h3 className="label-caps">Mission</h3>
        <span className="font-mono text-xs text-faint">Round {mission.round} / 2</span>
      </div>
      <div className="border border-border rounded p-3 bg-surface">
        <div className="flex items-baseline justify-between mb-2">
          <span className="font-mono text-sm text-primary">{def.name}</span>
          <span className="font-mono text-xs text-amber">+{def.reward} Progress</span>
        </div>
        {def.specialRule && (
          <p className="text-faint text-xs font-mono mb-2 leading-relaxed italic">
            {def.specialRule}
          </p>
        )}
        <div className="space-y-1.5">
          {reqs.map((r) => (
            <RequirementBar key={r.label} {...r} />
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-border flex gap-3 text-xs font-mono text-faint">
          <span>Fail: +{def.failTimerPenalty} Timer</span>
          <span>Pool: +{def.allocation.cpu} CPU / +{def.allocation.ram} RAM</span>
        </div>
      </div>
    </div>
  );
}

function RequirementBar({
  label,
  contributed,
  required,
}: {
  label: string;
  contributed: number;
  required: number;
}) {
  const done = contributed >= required;
  const pct = Math.min(100, (contributed / required) * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-[10px] font-mono text-muted">{label}</span>
        <span className={`text-[10px] font-mono ${done ? "text-amber" : "text-faint"}`}>
          {contributed} / {required}
        </span>
      </div>
      <div className="h-1.5 bg-base rounded overflow-hidden border border-border">
        <div
          className={`h-full transition-all duration-300 ${done ? "bg-amber" : "bg-muted"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
