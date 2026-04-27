"use client";

import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];

export interface ResourceChipConfig {
  mode: "adjustment" | "allocation";
  pendingCpu: number;
  pendingRam: number;
  cpuMinus: { enabled: boolean; onClick: () => void } | null;
  cpuPlus: { enabled: boolean; onClick: () => void } | null;
  ramMinus: { enabled: boolean; onClick: () => void } | null;
  ramPlus: { enabled: boolean; onClick: () => void } | null;
}

interface Props {
  aiPlayers: PlayerRow[]; // sorted by turn_order 0–3; slot A=index 0 (TL), B=1 (TR), C=2 (BR), D=3 (BL)
  coreProgress: number;
  currentTurnPlayerId?: string;
  turnOrderIds?: string[];
  resourceChips?: Record<string, ResourceChipConfig>; // keyed by player.id; set during resource phases
}

// Fixed chip slots per UX_DESIGN §13 — do NOT generalise for other player counts
const CHIP_SLOTS = [
  { label: "A", x: 110, y: 90, isTop: true },
  { label: "B", x: 390, y: 90, isTop: true },
  { label: "C", x: 390, y: 330, isTop: false },
  { label: "D", x: 110, y: 330, isTop: false },
] as const;

// Pin x-offsets shared by all AI chips (8 pins, 6×4 each)
const AI_PIN_X = [15, 32, 49, 66, 83, 100, 117, 134] as const;
// Pin x-offsets for the wider core chip (10 pins, 4×4 each)
const CORE_PIN_X = [15, 25, 35, 45, 55, 65, 75, 85, 95, 105] as const;

function SVGChipButton({
  x,
  y,
  label,
  enabled,
  onClick,
}: {
  x: number;
  y: number;
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={enabled ? onClick : undefined}
      style={{ cursor: enabled ? "pointer" : "default" }}
    >
      <rect
        x="0"
        y="0"
        width="12"
        height="10"
        fill={enabled ? "#2a3a2a" : "#141414"}
        stroke={enabled ? "#5a7a5a" : "#222"}
        strokeWidth="0.5"
        rx="1"
      />
      <text
        x="6"
        y="8"
        fontFamily="monospace"
        fontSize="9"
        fill={enabled ? "#9cd4b4" : "#333"}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

function AIChipGroup({
  slotLabel,
  chipX,
  chipY,
  isTop,
  player,
  isActive,
  missionSeatNum,
  resourceChip,
}: {
  slotLabel: string;
  chipX: number;
  chipY: number;
  isTop: boolean;
  player: PlayerRow | undefined;
  isActive: boolean;
  missionSeatNum: number | null;
  resourceChip?: ResourceChipConfig;
}) {
  const cpuFilled = Math.min(player?.cpu ?? 1, 4);
  const ramFilled = Math.min(player?.ram ?? 4, 5);
  const seatNum = missionSeatNum !== null ? String(missionSeatNum) : "?";
  const name = player?.display_name ?? "—";

  // Contribution counter row sits inward (below top chips, above bottom chips)
  const counterY = isTop ? chipY + 98 : chipY - 28;

  // Active-state colors (§5.4)
  const chipFill     = isActive ? "#241f10" : "#1a2418";
  const chipStroke   = isActive ? "#d4a017" : "#3a5a3a";
  const pinFill      = isActive ? "#5a4a1a" : "#2a3a2a";
  const circleFill   = isActive ? "#3a2e1a" : "#2a3a2a";
  const circleStroke = isActive ? "#a87a17" : "#5a7a5a";
  const seatText     = isActive ? "#d4a017" : "#9cd4b4";
  const labelText    = isActive ? "#a87a17" : "#5a7a5a";
  const nameColor    = isActive ? "#f4d47e" : "#cce4d4";
  const trackLabel   = isActive ? "#a87a17" : "#7a9a8a";
  const trackFill    = isActive ? "#d4a017" : "#5dcaa5";
  const trackStroke  = isActive ? "#5a4a1a" : "#3a5a4a";
  const counterText  = isActive ? "#a87a17" : "#7a8a9a";
  const dotSep       = isActive ? "#5a4a1a" : "#3a4a3a";

  // Pending-state visual helpers (§5.2)
  // For each CPU square i (0–3):
  //   adjustment: squares below target = solid; squares [target..cpu) = outlined red dashed
  //   allocation: squares below cpu = solid; squares [cpu..cpu+pending) = outlined amber dashed
  function cpuSquareProps(i: number) {
    if (!resourceChip) {
      return { fill: i < cpuFilled ? trackFill : "none", stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
    }
    if (resourceChip.mode === "adjustment") {
      const target = cpuFilled - resourceChip.pendingCpu;
      if (i < target) return { fill: trackFill, stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
      if (i < cpuFilled) return { fill: "none", stroke: "#a32d2d", strokeWidth: 1.5, strokeDasharray: "2 1" };
      return { fill: "none", stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
    } else {
      const addEnd = cpuFilled + resourceChip.pendingCpu;
      if (i < cpuFilled) return { fill: trackFill, stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
      if (i < addEnd) return { fill: "none", stroke: "#d4a017", strokeWidth: 1.5, strokeDasharray: "2 1" };
      return { fill: "none", stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
    }
  }

  function ramSquareProps(i: number) {
    if (!resourceChip) {
      return { fill: i < ramFilled ? trackFill : "none", stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
    }
    if (resourceChip.mode === "adjustment") {
      const target = ramFilled - resourceChip.pendingRam;
      if (i < target) return { fill: trackFill, stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
      if (i < ramFilled) return { fill: "none", stroke: "#a32d2d", strokeWidth: 1.5, strokeDasharray: "2 1" };
      return { fill: "none", stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
    } else {
      const addEnd = ramFilled + resourceChip.pendingRam;
      if (i < ramFilled) return { fill: trackFill, stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
      if (i < addEnd) return { fill: "none", stroke: "#d4a017", strokeWidth: 1.5, strokeDasharray: "2 1" };
      return { fill: "none", stroke: trackStroke, strokeWidth: 0.5, strokeDasharray: undefined };
    }
  }

  const showButtons = !!(
    resourceChip &&
    (resourceChip.cpuMinus || resourceChip.cpuPlus || resourceChip.ramMinus || resourceChip.ramPlus)
  );

  return (
    <g>
      {/* Outer amber active border — 5px outside chip, per §5.4 */}
      {isActive && (
        <rect
          x={chipX - 5}
          y={chipY - 5}
          width={170}
          height={100}
          fill="none"
          stroke="#d4a017"
          strokeWidth={2}
          rx={4}
          opacity={0.4}
        />
      )}

      {/* Contribution counters — all zeros for scaffolding */}
      <g transform={`translate(${chipX}, ${counterY})`}>
        <text x="14" y="14" fontFamily="sans-serif" fontSize="11" fill="#9cb4d4" textAnchor="middle">⚙</text>
        <text x="26" y="14" fontFamily="monospace" fontSize="11" fill={counterText}>0</text>
        <text x="44" y="13" fontFamily="monospace" fontSize="9" fill={dotSep}>·</text>
        <text x="68" y="14" fontFamily="sans-serif" fontSize="11" fill="#5dcaa5" textAnchor="middle">▣</text>
        <text x="80" y="14" fontFamily="monospace" fontSize="11" fill={counterText}>0</text>
        <text x="98" y="13" fontFamily="monospace" fontSize="9" fill={dotSep}>·</text>
        <text x="122" y="14" fontFamily="sans-serif" fontSize="11" fill="#caa55d" textAnchor="middle">◆</text>
        <text x="134" y="14" fontFamily="monospace" fontSize="11" fill={counterText}>0</text>
      </g>

      {/* Chip body group — local origin at chip top-left */}
      <g transform={`translate(${chipX}, ${chipY})`}>
        {/* Top pins */}
        {AI_PIN_X.map((x) => (
          <rect key={`tp${x}`} x={x} y={-4} width={6} height={4} fill={pinFill} />
        ))}

        {/* Chip body */}
        <rect
          x="0"
          y="0"
          width="160"
          height="90"
          fill={chipFill}
          stroke={chipStroke}
          strokeWidth={isActive ? 2 : 1.5}
          rx="3"
        />

        {/* Bottom pins */}
        {AI_PIN_X.map((x) => (
          <rect key={`bp${x}`} x={x} y={90} width={6} height={4} fill={pinFill} />
        ))}

        {/* Seat number circle */}
        <circle cx="18" cy="18" r="11" fill={circleFill} stroke={circleStroke} strokeWidth="1" />
        <text x="18" y="22" fontFamily="monospace" fontSize="12" fill={seatText} textAnchor="middle">
          {seatNum}
        </text>

        {/* Chip label */}
        <text x="38" y="23" fontFamily="monospace" fontSize="9" fill={labelText} letterSpacing="1">
          AI-CHIP-{slotLabel}
        </text>

        {/* ACTIVE tag — right-aligned at x=155, same y as chip label */}
        {isActive && (
          <text x="155" y="23" fontFamily="monospace" fontSize="9" fill="#d4a017" textAnchor="end">
            ▸ ACTIVE
          </text>
        )}

        {/* Player name */}
        <text x="15" y="48" fontFamily="sans-serif" fontSize="14" fill={nameColor}>
          {name}
        </text>

        {/* CPU label */}
        <text x="15" y="68" fontFamily="monospace" fontSize="10" fill={trackLabel}>
          CPU
        </text>

        {/* CPU track — 4 squares of 10×10, stride 11 */}
        {([0, 1, 2, 3] as const).map((i) => {
          const sq = cpuSquareProps(i);
          return (
            <rect
              key={i}
              x={40 + i * 11}
              y={61}
              width="10"
              height="10"
              fill={sq.fill}
              stroke={sq.stroke}
              strokeWidth={sq.strokeWidth}
              strokeDasharray={sq.strokeDasharray}
            />
          );
        })}

        {/* RAM label */}
        <text x="90" y="68" fontFamily="monospace" fontSize="10" fill={trackLabel}>
          RAM
        </text>

        {/* RAM track — 5 squares of 6×10, stride 7 */}
        {([0, 1, 2, 3, 4] as const).map((i) => {
          const sq = ramSquareProps(i);
          return (
            <rect
              key={i}
              x={115 + i * 7}
              y={61}
              width="6"
              height="10"
              fill={sq.fill}
              stroke={sq.stroke}
              strokeWidth={sq.strokeWidth}
              strokeDasharray={sq.strokeDasharray}
            />
          );
        })}

        {/* Hand stack placeholder — 3 overlapping 14×10 cards */}
        <rect x="4"  y="74" width="14" height="10" fill="#0c1410" stroke="#3a5a4a" strokeWidth="0.5" rx="1" />
        <rect x="2"  y="76" width="14" height="10" fill="#0c1410" stroke="#3a5a4a" strokeWidth="0.5" rx="1" />
        <rect x="0"  y="78" width="14" height="10" fill="#0c1410" stroke="#3a5a4a" strokeWidth="0.5" rx="1" />
        <text x="22" y="86" fontFamily="monospace" fontSize="9" fill="#9cb4a4">×? cards</text>

        {/* Resource [-]/[+] buttons — rendered outside chip body to the right */}
        {showButtons && resourceChip && (
          <g>
            {/* CPU row label */}
            <text x="163" y="69" fontFamily="monospace" fontSize="7" fill="#7a9a8a">C</text>
            {/* CPU [-] */}
            {resourceChip.cpuMinus && (
              <SVGChipButton
                x={171}
                y={61}
                label="−"
                enabled={resourceChip.cpuMinus.enabled}
                onClick={resourceChip.cpuMinus.onClick}
              />
            )}
            {/* CPU [+] */}
            {resourceChip.cpuPlus && (
              <SVGChipButton
                x={185}
                y={61}
                label="+"
                enabled={resourceChip.cpuPlus.enabled}
                onClick={resourceChip.cpuPlus.onClick}
              />
            )}
            {/* RAM row label */}
            <text x="163" y="82" fontFamily="monospace" fontSize="7" fill="#7a9a8a">R</text>
            {/* RAM [-] */}
            {resourceChip.ramMinus && (
              <SVGChipButton
                x={171}
                y={74}
                label="−"
                enabled={resourceChip.ramMinus.enabled}
                onClick={resourceChip.ramMinus.onClick}
              />
            )}
            {/* RAM [+] */}
            {resourceChip.ramPlus && (
              <SVGChipButton
                x={185}
                y={74}
                label="+"
                enabled={resourceChip.ramPlus.enabled}
                onClick={resourceChip.ramPlus.onClick}
              />
            )}
          </g>
        )}
      </g>
    </g>
  );
}

function CoreChipGroup({ coreProgress }: { coreProgress: number }) {
  // Core chip at panel coords (270, 200) — size 120×100
  const cx = 270;
  const cy = 200;

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Top pins */}
      {CORE_PIN_X.map((x) => (
        <rect key={`ct${x}`} x={x} y={-4} width={4} height={4} fill="#3a4a5a" />
      ))}

      {/* Chip body */}
      <rect
        x="0"
        y="0"
        width="120"
        height="100"
        fill="#101820"
        stroke="#4a6a8a"
        strokeWidth="1.5"
        rx="3"
      />

      {/* Bottom pins */}
      {CORE_PIN_X.map((x) => (
        <rect key={`cb${x}`} x={x} y={100} width={4} height={4} fill="#3a4a5a" />
      ))}

      {/* Labels */}
      <text
        x="60"
        y="17"
        fontFamily="monospace"
        fontSize="9"
        fill="#5a7a9a"
        letterSpacing="2"
        textAnchor="middle"
      >
        {"// CORE SYSTEM"}
      </text>
      <text
        x="60"
        y="35"
        fontFamily="monospace"
        fontSize="10"
        fill="#888"
        textAnchor="middle"
      >
        RESEARCH
      </text>

      {/* 5×2 grid of progress squares, origin at (10, 45), each 14×14, stride 18 */}
      {Array.from({ length: 10 }, (_, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const filled = i < coreProgress;
        return (
          <rect
            key={i}
            x={10 + col * 18}
            y={45 + row * 18}
            width="14"
            height="14"
            fill={filled ? "#d4a017" : "#1a1a1a"}
            stroke={filled ? "#5a4a1a" : "#3a3a3a"}
            strokeWidth="0.5"
            rx="1"
          />
        );
      })}
      {/* No numeric label — progress is communicated visually; the tracker bar shows the number */}
    </g>
  );
}

export function CentralBoard({
  aiPlayers,
  coreProgress,
  currentTurnPlayerId,
  turnOrderIds = [],
  resourceChips,
}: Props) {
  return (
    // Panel: x=430, y=180 in board coords → 660×500
    <svg
      width="660"
      height="500"
      viewBox="0 0 660 500"
      style={{ position: "absolute", left: 430, top: 180 }}
    >
      {/* Circuit board background */}
      <rect
        x="0"
        y="0"
        width="660"
        height="500"
        fill="#0c1410"
        stroke="#1a3020"
        strokeWidth="1"
        rx="4"
      />

      {/* Corner circuit trace decorations */}
      <g stroke="#1a3020" strokeWidth="0.5" fill="none" opacity="0.6">
        <path d="M 30 40 L 70 40 L 70 70" />
        <path d="M 630 40 L 590 40 L 590 70" />
        <path d="M 30 460 L 70 460 L 70 430" />
        <path d="M 630 460 L 590 460 L 590 430" />
        <path d="M 30 260 L 50 260" />
        <path d="M 630 260 L 610 260" />
      </g>
      <g fill="#1a3020">
        <circle cx="30"  cy="40"  r="2" />
        <circle cx="630" cy="40"  r="2" />
        <circle cx="30"  cy="460" r="2" />
        <circle cx="630" cy="460" r="2" />
        <circle cx="30"  cy="260" r="2" />
        <circle cx="630" cy="260" r="2" />
      </g>

      {/* "FIREWALL · CONTAINMENT" label */}
      <text
        x="330"
        y="22"
        fontFamily="monospace"
        fontSize="10"
        fill="#3a6a4a"
        textAnchor="middle"
        letterSpacing="3"
      >
        FIREWALL · CONTAINMENT
      </text>

      {/* Outer glow ring */}
      <ellipse
        cx="330"
        cy="250"
        rx="296"
        ry="226"
        fill="none"
        stroke="#1a3020"
        strokeWidth="0.5"
      />

      {/* Main firewall ellipse — teal-green dashed */}
      <ellipse
        cx="330"
        cy="250"
        rx="290"
        ry="220"
        fill="none"
        stroke="#2a4a3a"
        strokeWidth="2"
        strokeDasharray="6 4"
      />

      {/* Central core chip */}
      <CoreChipGroup coreProgress={coreProgress} />

      {/* AI chip cluster — 4 fixed positions */}
      {CHIP_SLOTS.map((slot, i) => {
        const player = aiPlayers[i];
        const isActive = !!player && !!currentTurnPlayerId && player.id === currentTurnPlayerId;
        const missionIdx = player ? turnOrderIds.indexOf(player.id) : -1;
        const missionSeatNum = missionIdx >= 0 ? missionIdx + 1 : null;
        return (
          <AIChipGroup
            key={slot.label}
            slotLabel={slot.label}
            chipX={slot.x}
            chipY={slot.y}
            isTop={slot.isTop}
            player={player}
            isActive={isActive}
            missionSeatNum={missionSeatNum}
            resourceChip={player ? resourceChips?.[player.id] : undefined}
          />
        );
      })}
    </svg>
  );
}
