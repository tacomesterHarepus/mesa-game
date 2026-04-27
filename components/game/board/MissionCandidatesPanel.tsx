import { MISSION_MAP } from "@/lib/game/missions";

interface Props {
  pendingOptions: string[];
  selected: string | null;
  onSelect: (key: string) => void;
  isHuman: boolean;
}

export function MissionCandidatesPanel({ pendingOptions, selected, onSelect, isHuman }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        left: 32,
        top: 180,
        width: 348,
        height: 385,
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
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "#d4a017",
            letterSpacing: 2,
          }}
        >
          CANDIDATES
        </span>
      </div>

      {/* Card stack */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          height: "calc(100% - 22px)",
          padding: "8px 10px",
        }}
      >
        {pendingOptions.map((key) => {
          const def = MISSION_MAP[key];
          if (!def) return null;
          const isSelected = selected === key;

          const reqs = [
            def.requirements.compute && `${def.requirements.compute} Compute`,
            def.requirements.data && `${def.requirements.data} Data`,
            def.requirements.validation && `${def.requirements.validation} Validation`,
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <button
              key={key}
              type="button"
              className="w-full text-left"
              disabled={!isHuman}
              onClick={() => isHuman && onSelect(key)}
              style={{
                flex: 1,
                background: isSelected ? "#1a1810" : "#0e0e0e",
                border: isSelected ? "2px solid #d4a017" : "1px solid #2a2a2a",
                borderRadius: 2,
                padding: "8px 10px",
                cursor: isHuman ? "pointer" : "default",
                textAlign: "left",
                display: "block",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 3,
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: isSelected ? "#d4a017" : "#888",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {def.name}
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: "#d4a017", marginLeft: 6, flexShrink: 0 }}>
                  +{def.reward}
                </span>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color: isSelected ? "#888" : "#555" }}>
                {reqs}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color: "#555", marginTop: 2 }}>
                Allocate: +{def.allocation.cpu} CPU, +{def.allocation.ram} RAM
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color: "#444", marginTop: 1 }}>
                Fail: +{def.failTimerPenalty} Timer
              </div>
              {def.specialRule && (
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: 9,
                    color: "#444",
                    marginTop: 3,
                    fontStyle: "italic",
                  }}
                >
                  {def.specialRule}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
