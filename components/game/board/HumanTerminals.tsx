import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];

interface Props {
  humanPlayers: PlayerRow[];
}

const TERMINALS = [
  { label: "TERM-01", x: 540 },
  { label: "TERM-02", x: 740 },
] as const;

export function HumanTerminals({ humanPlayers }: Props) {
  return (
    <>
      {/* "OUTSIDE FIREWALL" label centered above terminals */}
      <div
        style={{
          position: "absolute",
          top: 72,
          left: 430,
          width: 660,
          textAlign: "center",
          fontFamily: "monospace",
          fontSize: 10,
          color: "#5a7a9a",
          letterSpacing: 2,
        }}
      >
        {"// HUMAN OPERATORS · OUTSIDE FIREWALL"}
      </div>

      {/* Terminal cards */}
      {TERMINALS.map(({ label, x }, i) => {
        const player = humanPlayers[i] ?? null;
        return (
          <div
            key={label}
            style={{
              position: "absolute",
              left: x,
              top: 100,
              width: 180,
              height: 68,
              background: "#0a1218",
              border: "1px solid #2a4a6a",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            {/* Header strip */}
            <div
              style={{
                height: 14,
                background: "#1a2a3a",
                display: "flex",
                alignItems: "center",
                paddingLeft: 8,
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "#5dcaa5",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 8,
                  color: "#5a7a9a",
                  letterSpacing: 1,
                }}
              >
                {label} / ONLINE
              </span>
            </div>

            {/* Body */}
            <div style={{ padding: "10px 12px 0" }}>
              <div
                style={{
                  fontFamily: "sans-serif",
                  fontSize: 13,
                  color: "#cce0f4",
                  marginBottom: 4,
                }}
              >
                {player ? player.display_name : "—"}
              </div>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 10,
                  color: "#5a7a9a",
                }}
              >
                watching...
              </div>
            </div>
          </div>
        );
      })}

      {/* Data-link lines from terminals down into the firewall area */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1440,
          height: 200,
          pointerEvents: "none",
        }}
      >
        <line
          x1="630"
          y1="168"
          x2="630"
          y2="195"
          stroke="#1a3a5a"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
        <line
          x1="830"
          y1="168"
          x2="830"
          y2="195"
          stroke="#1a3a5a"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
      </svg>
    </>
  );
}
