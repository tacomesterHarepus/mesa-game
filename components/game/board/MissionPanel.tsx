import { MISSION_MAP } from "@/lib/game/missions";
import type { Database } from "@/types/supabase";

type ActiveMission = Database["public"]["Tables"]["active_mission"]["Row"];

interface Props {
  mission: ActiveMission | null;
}

export function MissionPanel({ mission }: Props) {
  const missionDef = mission ? (MISSION_MAP[mission.mission_key] ?? null) : null;

  const requirements = missionDef
    ? (
        [
          {
            label: "Compute",
            contributed: mission!.compute_contributed,
            required: missionDef.requirements.compute ?? 0,
          },
          {
            label: "Data",
            contributed: mission!.data_contributed,
            required: missionDef.requirements.data ?? 0,
          },
          {
            label: "Validation",
            contributed: mission!.validation_contributed,
            required: missionDef.requirements.validation ?? 0,
          },
        ] as const
      ).filter((r) => r.required > 0)
    : [];

  return (
    <div
      style={{
        position: "absolute",
        left: 32,
        top: 180,
        width: 348,
        height: 200,
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
          background: "#161616",
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
        }}
      >
        <h2
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "#d4a017",
            letterSpacing: 2,
            margin: 0,
            padding: 0,
            fontWeight: "normal",
          }}
        >
          MISSION
        </h2>
      </div>

      {/* Body */}
      <div style={{ padding: "10px 12px", height: "calc(100% - 22px)", position: "relative" }}>
        {missionDef ? (
          <>
            <div
              style={{
                fontFamily: "sans-serif",
                fontSize: 15,
                color: "#d4a017",
                marginBottom: 4,
              }}
            >
              {missionDef.name}
            </div>

            {missionDef.specialRule && (
              <div
                style={{
                  fontFamily: "sans-serif",
                  fontSize: 12,
                  color: "#888",
                  fontStyle: "italic",
                  marginBottom: 10,
                }}
              >
                {missionDef.specialRule}
              </div>
            )}

            {/* Requirement progress bars */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {requirements.map((req) => {
                const fillPct =
                  req.required > 0
                    ? Math.min(req.contributed / req.required, 1) * 100
                    : 0;
                const complete = req.contributed >= req.required;
                return (
                  <div key={req.label}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 2,
                      }}
                    >
                      <span
                        style={{ fontFamily: "sans-serif", fontSize: 13, color: "#aaa" }}
                      >
                        {req.label}
                      </span>
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: 13,
                          fontWeight: "bold",
                          color: complete ? "#d4a017" : "#aaa",
                        }}
                      >
                        {req.contributed} / {req.required}
                      </span>
                    </div>
                    <div style={{ height: 3, background: "#222" }}>
                      <div
                        style={{
                          height: 3,
                          width: `${fillPct}%`,
                          background: complete ? "#d4a017" : "#888",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer: fail penalty + allocation pool */}
            <div
              style={{
                position: "absolute",
                bottom: 8,
                left: 12,
                fontFamily: "monospace",
                fontSize: 10,
                color: "#555",
              }}
            >
              Fail: +{missionDef.failTimerPenalty} Timer · Pool: +
              {missionDef.allocation.cpu} CPU / +{missionDef.allocation.ram} RAM
            </div>
          </>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              fontFamily: "monospace",
              fontSize: 10,
              color: "#555",
              letterSpacing: 2,
            }}
          >
            MISSION · NONE
          </div>
        )}
      </div>
    </div>
  );
}
