"use client";

import { CARD_MAP } from "@/lib/game/cards";
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

export interface RevealChipConfig {
  hasRevealed: boolean;
  revealedCardKey: string | null;
  isOwnSlot: boolean;
  ownerName: string;
}

export interface VirusResolvingCard {
  id: string;
  card_key: string;
  cascaded_from?: string | null;
}

export interface TargetingChipConfig {
  state: "selectable" | "nominated" | "watching";
  isSelf: boolean;
  isFellow: boolean;
  onNominate?: () => void;
}

interface Props {
  aiPlayers: PlayerRow[]; // sorted by turn_order 0–3; slot A=index 0 (TL), B=1 (TR), C=2 (BR), D=3 (BL)
  coreProgress: number;
  currentTurnPlayerId?: string;
  turnOrderIds?: string[];
  resourceChips?: Record<string, ResourceChipConfig>; // keyed by player.id; set during resource phases
  revealSlots?: Record<string, RevealChipConfig>;     // keyed by player.id; set during card_reveal
  targetingChips?: Record<string, TargetingChipConfig>; // keyed by player.id; set during secret_targeting
  contributions?: Record<string, { compute: number; data: number; validation: number }>;
  showMisBadges?: Record<string, boolean>; // keyed by player.id; true for chips the viewer knows are misaligned
  dimCore?: boolean;
  virusResolvingCard?: VirusResolvingCard | null;
  isGameOver?: boolean;
  gameOverWinner?: "humans" | "misaligned" | null;
  gameOverRoles?: Record<string, string>; // player.id → "aligned_ai" | "misaligned_ai"
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

function RevealSlotGroup({
  slot,
  slotSide,
}: {
  slot: RevealChipConfig;
  slotSide: "left" | "right";
}) {
  const slotX = slotSide === "left" ? -65 : 165;
  const slotY = 3;

  if (slot.hasRevealed && slot.revealedCardKey) {
    const cardDef = CARD_MAP[slot.revealedCardKey];
    const isVirus = cardDef?.type === "virus";
    const icon =
      slot.revealedCardKey === "compute" ? "⚙"
      : slot.revealedCardKey === "data" ? "▣"
      : slot.revealedCardKey === "validation" ? "◆"
      : "⚠";
    const iconColor =
      isVirus ? "#a32d2d"
      : slot.revealedCardKey === "data" ? "#5dcaa5"
      : slot.revealedCardKey === "validation" ? "#caa55d"
      : "#9cb4d4";
    const cardName = (cardDef?.name ?? slot.revealedCardKey).toUpperCase().slice(0, 9);

    return (
      <g transform={`translate(${slotX}, ${slotY})`}>
        <rect x="0" y="0" width="60" height="84" fill={isVirus ? "#180c0c" : "#0c1410"}
          stroke={isVirus ? "#a32d2d" : "#3a5a4a"} strokeWidth="1" rx="2" />
        <rect x="0" y="0" width="60" height="18" fill={isVirus ? "#2a1010" : "#0f1820"} rx="2" />
        <text x="30" y="44" textAnchor="middle" fontFamily="sans-serif" fontSize="22" fill={iconColor}>{icon}</text>
        <text x="30" y="62" textAnchor="middle" fontFamily="monospace" fontSize="7"
          fill={iconColor} letterSpacing="0.5">{cardName}</text>
        <text x="30" y="76" textAnchor="middle" fontFamily="sans-serif" fontSize="8"
          fill="#888">{slot.ownerName.slice(0, 8)}</text>
      </g>
    );
  }

  // Pending (selecting) state
  const borderColor = slot.isOwnSlot ? "#d4a017" : "#3a3a3a";
  const borderWidth = slot.isOwnSlot ? 1.5 : 1;
  const questionColor = slot.isOwnSlot ? "#d4a017" : "#444";
  const labelColor = slot.isOwnSlot ? "#a87a17" : "#555";

  return (
    <g transform={`translate(${slotX}, ${slotY})`}>
      <rect x="0" y="0" width="60" height="84" fill="none"
        stroke={borderColor} strokeWidth={borderWidth} strokeDasharray="3 2" rx="2" />
      <text x="30" y="48" textAnchor="middle" fontFamily="monospace" fontSize="24" fill={questionColor}>?</text>
      <text x="30" y="70" textAnchor="middle" fontFamily="monospace" fontSize="7"
        fill={labelColor} letterSpacing="1">SELECTING</text>
    </g>
  );
}

// Slot sides by chip index: A(TL)=left, B(TR)=right, C(BR)=right, D(BL)=left
const SLOT_SIDES: ("left" | "right")[] = ["left", "right", "right", "left"];

function AIChipGroup({
  slotLabel,
  chipX,
  chipY,
  isTop,
  player,
  isActive: isActiveRaw,
  missionSeatNum,
  resourceChip,
  revealSlot,
  targetingChip,
  contributions,
  slotSide = "left",
  isGameOver,
  gameOverRole,
  showMisBadge = false,
}: {
  slotLabel: string;
  chipX: number;
  chipY: number;
  isTop: boolean;
  player: PlayerRow | undefined;
  isActive: boolean;
  missionSeatNum: number | null;
  resourceChip?: ResourceChipConfig;
  revealSlot?: RevealChipConfig;
  targetingChip?: TargetingChipConfig;
  contributions?: { compute: number; data: number; validation: number };
  slotSide?: "left" | "right";
  isGameOver?: boolean;
  gameOverRole?: string;
  showMisBadge?: boolean;
}) {
  const isActive = isActiveRaw && !isGameOver;
  const cpuFilled = Math.min(player?.cpu ?? 1, 4);
  const ramFilled = Math.min(player?.ram ?? 4, 7);
  const seatNum = isGameOver ? "·" : (missionSeatNum !== null ? String(missionSeatNum) : "?");
  const name = player?.display_name ?? "—";

  // Contribution counter row sits inward (below top chips, above bottom chips)
  const counterY = isTop ? chipY + 98 : chipY - 28;

  // Active-state colors (§5.4)
  // In game_over: isActive is forced false; colors are determined by revealed role instead.
  const goAligned = isGameOver && gameOverRole === "aligned_ai";
  const goMisaligned = isGameOver && gameOverRole === "misaligned_ai";

  const chipFill     = isActive ? "#241f10" : goAligned ? "#0c1a14" : goMisaligned ? "#1a0c0c" : "#1a2418";
  const chipStroke   = isActive ? "#d4a017" : goAligned ? "#5dcaa5" : goMisaligned ? "#a32d2d" : "#3a5a3a";
  const chipStrokeW  = (isActive || goAligned || goMisaligned) ? 2 : 1.5;
  const pinFill      = isActive ? "#5a4a1a" : goAligned ? "#1a3a2a" : goMisaligned ? "#3a1a1a" : "#2a3a2a";
  const circleFill   = isActive ? "#3a2e1a" : goAligned ? "#1a3a2a" : goMisaligned ? "#3a1a1a" : "#2a3a2a";
  const circleStroke = isActive ? "#a87a17" : goAligned ? "#5dcaa5" : goMisaligned ? "#a32d2d" : "#5a7a5a";
  const seatText     = isActive ? "#d4a017" : goAligned ? "#9cd4b4" : goMisaligned ? "#cca0a0" : "#9cd4b4";
  const labelText    = isActive ? "#a87a17" : goAligned ? "#5dcaa5" : goMisaligned ? "#a32d2d" : "#5a7a5a";
  const nameColor    = isActive ? "#f4d47e" : goAligned ? "#9cd4b4" : goMisaligned ? "#cca0a0" : "#cce4d4";
  const trackLabel   = isActive ? "#a87a17" : "#7a9a8a";
  const trackFill    = isActive ? "#d4a017" : "#5dcaa5";
  const trackStroke  = isActive ? "#5a4a1a" : "#3a5a4a";
  const counterText  = isActive ? "#a87a17" : goMisaligned ? "#9a7a7a" : "#7a8a9a";

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

  const isTargetSelectable = targetingChip?.state === "selectable";
  const isTargetNominated = targetingChip?.state === "nominated";

  return (
    <g
      onClick={isTargetSelectable ? targetingChip?.onNominate : undefined}
      style={{ cursor: isTargetSelectable ? "pointer" : "default" }}
    >
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

      {/* Targeting rings — rendered outside chip body like the active ring */}
      {isTargetSelectable && (
        <rect
          x={chipX - 5}
          y={chipY - 5}
          width={170}
          height={100}
          fill="none"
          stroke="#d4a017"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          rx={4}
          opacity={0.7}
        />
      )}
      {isTargetNominated && (
        <rect
          x={chipX - 5}
          y={chipY - 5}
          width={170}
          height={100}
          fill="none"
          stroke="#a32d2d"
          strokeWidth={2}
          rx={4}
        />
      )}

      {/* Contribution counters OR targeting label */}
      <g transform={`translate(${chipX}, ${counterY})`}>
        {isTargetNominated ? (
          <text x="80" y="14" fontFamily="monospace" fontSize="8" fill="#a32d2d" textAnchor="middle" letterSpacing="1">
            {"▸ NOMINATED"}
          </text>
        ) : isTargetSelectable ? (
          <text x="80" y="14" fontFamily="monospace" fontSize="7" fill="#d4a017" textAnchor="middle" letterSpacing="1">
            CLICK TO NOMINATE
          </text>
        ) : (
          <>
            <text x="14" y="14" fontFamily="sans-serif" fontSize="13" fill="#9cb4d4" textAnchor="middle">⚙</text>
            <text x="28" y="15" fontFamily="monospace" fontSize="13" fontWeight="bold" fill={counterText}>{contributions?.compute ?? 0}</text>
            <text x="68" y="14" fontFamily="sans-serif" fontSize="13" fill="#5dcaa5" textAnchor="middle">▣</text>
            <text x="82" y="15" fontFamily="monospace" fontSize="13" fontWeight="bold" fill={counterText}>{contributions?.data ?? 0}</text>
            <text x="122" y="14" fontFamily="sans-serif" fontSize="13" fill="#caa55d" textAnchor="middle">◆</text>
            <text x="136" y="15" fontFamily="monospace" fontSize="13" fontWeight="bold" fill={counterText}>{contributions?.validation ?? 0}</text>
          </>
        )}
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
          strokeWidth={chipStrokeW}
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

        {/* Role badge — shown during game_over replacing ACTIVE tag */}
        {goAligned && (
          <>
            <rect x="90" y="6" width="62" height="14" fill="#1a3a2a" stroke="#5dcaa5" strokeWidth="0.5" rx="2" />
            <text x="121" y="16" fontFamily="monospace" fontSize="8" fill="#9cd4b4" textAnchor="middle" letterSpacing="1">ALIGNED</text>
          </>
        )}
        {goMisaligned && (
          <>
            <rect x="79" y="6" width="80" height="14" fill="#3a1a1a" stroke="#a32d2d" strokeWidth="0.5" rx="2" />
            <text x="119" y="16" fontFamily="monospace" fontSize="8" fill="#cca0a0" textAnchor="middle" letterSpacing="1">MISALIGNED</text>
          </>
        )}

        {/* MIS badge — permanent for misaligned viewers; hidden when ACTIVE tag or game_over role badge occupies same space */}
        {showMisBadge && !isActive && !isGameOver && (
          <text x="155" y="23" fontFamily="monospace" fontSize="8" fill="#a32d2d" textAnchor="end" letterSpacing="1">
            MIS
          </text>
        )}

        {/* Player name */}
        <text x="15" y="48" fontFamily="sans-serif" fontSize="14" fill={nameColor}>
          {name}
        </text>

        {/* CPU label */}
        <text x="15" y="68" fontFamily="monospace" fontSize="11" fill={trackLabel}>
          CPU
        </text>

        {/* CPU track — 4 squares of 11×11, stride 12 */}
        {([0, 1, 2, 3] as const).map((i) => {
          const sq = cpuSquareProps(i);
          return (
            <rect
              key={i}
              x={40 + i * 12}
              y={61}
              width="11"
              height="11"
              fill={sq.fill}
              stroke={sq.stroke}
              strokeWidth={sq.strokeWidth}
              strokeDasharray={sq.strokeDasharray}
            />
          );
        })}

        {/* RAM label */}
        <text x="90" y="68" fontFamily="monospace" fontSize="11" fill={trackLabel}>
          RAM
        </text>

        {/* RAM track — 7 squares of 7×11, stride 7, start x=110 (ends at 159, within 160-wide body) */}
        {([0, 1, 2, 3, 4, 5, 6] as const).map((i) => {
          const sq = ramSquareProps(i);
          return (
            <rect
              key={i}
              x={110 + i * 7}
              y={61}
              width="7"
              height="11"
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

        {/* Reveal slot — rendered in chip-local coords, to outside edge */}
        {revealSlot && (
          <RevealSlotGroup slot={revealSlot} slotSide={slotSide} />
        )}
      </g>
    </g>
  );
}

// ── Virus resolution overlay (§7.7) ─────────────────────────────────────────

const VIRUS_TYPE_LABEL: Record<string, string> = {
  cascading_failure:  "VIRUS · CASCADE",
  system_overload:    "VIRUS · SYSTEM",
  model_corruption:   "VIRUS · CORRUPTION",
  data_drift:         "VIRUS · DATA",
  validation_failure: "VIRUS · VALIDATION",
  pipeline_breakdown: "VIRUS · PIPELINE",
  dependency_error:   "VIRUS · DEPENDENCY",
  process_crash:      "VIRUS · PROCESS",
  memory_leak:        "VIRUS · MEMORY",
  resource_surge:     "VIRUS · RESOURCE",
  cpu_drain:          "VIRUS · CPU",
  memory_allocation:  "VIRUS · MEMORY",
};

const VIRUS_DISPLAY_NAME: Record<string, string> = {
  cascading_failure:   "Cascading Failure",
  system_overload:     "System Overload",
  model_corruption:    "Model Corruption",
  data_drift:          "Data Drift",
  validation_failure:  "Validation Failure",
  pipeline_breakdown:  "Pipeline Breakdown",
  dependency_error:    "Dependency Error",
  process_crash:       "Process Crash",
  memory_leak:         "Memory Leak",
  resource_surge:      "Resource Surge",
  cpu_drain:           "CPU Drain",
  memory_allocation:   "Memory Allocation",
};

const VIRUS_EFFECT_LINES: Record<string, string[]> = {
  cascading_failure:   ["Triggers 2 more viruses", "from the pool immediately."],
  system_overload:     ["Escape Timer +1."],
  model_corruption:    ["Remove 1 Compute", "from active mission."],
  data_drift:          ["Remove 1 Data", "from active mission."],
  validation_failure:  ["Remove 1 Validation", "from active mission."],
  pipeline_breakdown:  ["Next contribution has", "50% fail chance."],
  dependency_error:    ["Compute locked until", "Data is contributed."],
  process_crash:       ["Target AI skips", "their next turn."],
  memory_leak:         ["Target AI loses 1 RAM."],
  resource_surge:      ["Target AI gains 1 CPU."],
  cpu_drain:           ["Target AI loses 1 CPU."],
  memory_allocation:   ["Target AI gains 1 RAM."],
};

// Virus card overlay — positioned at SVG-local (220, 170) = global board (650, 350)
// Uses key on the parent g to force remount (restarting SMIL animate) for each new card.
function VirusCardOverlay({ card }: { card: VirusResolvingCard }) {
  const isProgress = card.card_key === "compute" || card.card_key === "data" || card.card_key === "validation";
  const typeLabel = isProgress ? "PROGRESS CARD" : (VIRUS_TYPE_LABEL[card.card_key] ?? "VIRUS · EFFECT");
  const displayName = isProgress
    ? card.card_key.charAt(0).toUpperCase() + card.card_key.slice(1)
    : (VIRUS_DISPLAY_NAME[card.card_key] ?? card.card_key.replace(/_/g, " "));
  const effectLines = isProgress
    ? ["No effect — progress", "card in virus pool."]
    : (VIRUS_EFFECT_LINES[card.card_key] ?? []);
  const icon = isProgress
    ? (card.card_key === "compute" ? "⚙" : card.card_key === "data" ? "▣" : "◆")
    : "⚠";
  const iconColor = isProgress ? "#9cb4d4" : "#a32d2d";
  const isCascaded = !!card.cascaded_from;

  return (
    <g transform="translate(220, 170)">
      {/* Shadow */}
      <rect x="-10" y="-5" width="240" height="200" fill="#1a0606" opacity="0.6" rx="6" />
      {/* Main card body */}
      <rect x="0" y="0" width="220" height="190" fill="#1a0a0a" stroke="#a32d2d" strokeWidth="2" rx="6" />
      {/* Header strip */}
      <rect x="0" y="0" width="220" height="28" fill="#3a1010" rx="6" />
      <rect x="0" y="18" width="220" height="10" fill="#3a1010" />
      {/* Type label */}
      <text x="14" y="20" fontFamily="monospace" fontSize="10" fill="#cca0a0" letterSpacing="2">
        {typeLabel}
      </text>
      {/* ↳ TRIGGERED badge — only when cascaded */}
      {isCascaded && (
        <>
          <rect x="148" y="8" width="64" height="14" fill="#1a0a0a" stroke="#a32d2d" strokeWidth="0.5" rx="2" />
          <text x="180" y="18" fontFamily="monospace" fontSize="8" fill="#cca0a0" textAnchor="middle" letterSpacing="1">
            {"↳ TRIGGERED"}
          </text>
        </>
      )}
      {/* Card name */}
      <text x="14" y="52" fontFamily="sans-serif" fontSize="18" fill="#f4c4c4">
        {displayName}
      </text>
      {/* Icon */}
      <text x="110" y="100" fontFamily="sans-serif" fontSize="42" fill={iconColor} textAnchor="middle">
        {icon}
      </text>
      {/* Separator */}
      <line x1="14" y1="128" x2="206" y2="128" stroke="#5a2a2a" strokeWidth="0.5" />
      {/* Effect lines */}
      {effectLines.map((line, i) => (
        <text key={i} x="14" y={144 + i * 15} fontFamily="sans-serif" fontSize="11" fill="#cca0a0">
          {line}
        </text>
      ))}
      {/* Pacing bar bg */}
      <rect x="0" y="185" width="220" height="5" fill="#1a1a1a" />
      {/* Pacing bar fill — SMIL animate restarts on remount via key prop in parent */}
      <rect x="0" y="185" height="5" fill="#a32d2d">
        {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
        {/* @ts-ignore — SMIL fill="freeze" is valid SVG but not in React's type defs */}
        <animate attributeName="width" from="0" to="220" dur="2s" fill="freeze" />
      </rect>
    </g>
  );
}

function WinnerBanner({ winner }: { winner: "humans" | "misaligned" | null }) {
  const isMisaligned = winner !== "humans";
  const shadowFill   = isMisaligned ? "#1a0606" : "#0a1a14";
  const bodyFill     = isMisaligned ? "#1a0a0a" : "#0a1a14";
  const bodyStroke   = isMisaligned ? "#a32d2d" : "#5dcaa5";
  const headerFill   = isMisaligned ? "#3a1010" : "#1a3a2a";
  const typeColor    = isMisaligned ? "#cca0a0" : "#9cd4b4";
  const titleFill    = isMisaligned ? "#f4c4c4" : "#cce4d4";
  const subFill      = isMisaligned ? "#cca0a0" : "#9cd4b4";
  const typeText     = isMisaligned ? "// CONTAINMENT FAILED · MISSION OVER" : "// MISSION COMPLETE · RESEARCH SECURED";
  const titleText    = isMisaligned ? "MISALIGNED AIs ESCAPED" : "HUMANS + ALIGNED AIs WIN";
  const subText      = isMisaligned ? "Escape Timer reached 8 / 8" : "Core Progress reached 10 / 10";

  return (
    <g>
      {/* Shadow */}
      <rect x="80" y="215" width="500" height="100" fill={shadowFill} rx="6" opacity="0.8" />
      {/* Banner body */}
      <rect x="90" y="225" width="480" height="80" fill={bodyFill} stroke={bodyStroke} strokeWidth="3" rx="6" />
      {/* Header strip */}
      <rect x="90" y="225" width="480" height="22" fill={headerFill} rx="6" />
      <rect x="90" y="236" width="480" height="11" fill={headerFill} />
      {/* Type label */}
      <text x="330" y="241" fontFamily="monospace" fontSize="10" fill={typeColor} textAnchor="middle" letterSpacing="2">
        {typeText}
      </text>
      {/* Main title */}
      <text x="330" y="272" fontFamily="sans-serif" fontSize="21" fill={titleFill} textAnchor="middle" letterSpacing="1">
        {titleText}
      </text>
      {/* Subtitle */}
      <text x="330" y="293" fontFamily="sans-serif" fontSize="12" fill={subFill} textAnchor="middle">
        {subText}
      </text>
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
  revealSlots,
  targetingChips,
  contributions,
  showMisBadges,
  dimCore,
  virusResolvingCard,
  isGameOver,
  gameOverWinner,
  gameOverRoles,
}: Props) {
  const goMisalignedWin = isGameOver && gameOverWinner === "misaligned";
  const boardFill    = goMisalignedWin ? "#180606" : "#0c1410";
  const boardStroke  = goMisalignedWin ? "#5a2a2a" : "#1a3020";
  const ellipseColor = goMisalignedWin ? "#5a2a2a" : "#2a4a3a";
  const ellipseDash  = goMisalignedWin ? "2 8" : "6 4";
  const glowColor    = goMisalignedWin ? "#3a1a1a" : "#1a3020";
  const labelColor   = goMisalignedWin ? "#5a2a2a" : "#3a6a4a";
  const labelText    = goMisalignedWin ? "FIREWALL · BREACHED · CONTAINMENT FAILED" : "FIREWALL · CONTAINMENT";

  return (
    // Panel: x=430, y=180 in board coords → 660×470
    <svg
      width="660"
      height="470"
      viewBox="0 0 660 470"
      style={{ position: "absolute", left: 430, top: 180 }}
    >
      {/* Circuit board background */}
      <rect
        x="0"
        y="0"
        width="660"
        height="500"
        fill={boardFill}
        stroke={boardStroke}
        strokeWidth="1"
        rx="4"
      />

      {/* Corner circuit trace decorations */}
      <g stroke={boardStroke} strokeWidth="0.5" fill="none" opacity="0.6">
        <path d="M 30 40 L 70 40 L 70 70" />
        <path d="M 630 40 L 590 40 L 590 70" />
        <path d="M 30 430 L 70 430 L 70 400" />
        <path d="M 630 430 L 590 430 L 590 400" />
        <path d="M 30 260 L 50 260" />
        <path d="M 630 260 L 610 260" />
      </g>
      <g fill={boardStroke}>
        <circle cx="30"  cy="40"  r="2" />
        <circle cx="630" cy="40"  r="2" />
        <circle cx="30"  cy="430" r="2" />
        <circle cx="630" cy="430" r="2" />
        <circle cx="30"  cy="260" r="2" />
        <circle cx="630" cy="260" r="2" />
      </g>

      {/* Board label */}
      <text
        x="330"
        y="22"
        fontFamily="monospace"
        fontSize="10"
        fill={labelColor}
        textAnchor="middle"
        letterSpacing="3"
      >
        {labelText}
      </text>

      {/* Outer glow ring */}
      <ellipse
        cx="330"
        cy="240"
        rx="296"
        ry="210"
        fill="none"
        stroke={glowColor}
        strokeWidth="0.5"
      />

      {/* Main firewall ellipse */}
      <ellipse
        cx="330"
        cy="240"
        rx="290"
        ry="220"
        fill="none"
        stroke={ellipseColor}
        strokeWidth="2"
        strokeDasharray={ellipseDash}
      />

      {/* Central core chip — dimmed during virus_resolution */}
      {dimCore ? (
        <g opacity={0.3}><CoreChipGroup coreProgress={coreProgress} /></g>
      ) : (
        <CoreChipGroup coreProgress={coreProgress} />
      )}

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
            revealSlot={player ? revealSlots?.[player.id] : undefined}
            targetingChip={player ? targetingChips?.[player.id] : undefined}
            contributions={player ? contributions?.[player.id] : undefined}
            showMisBadge={player ? (showMisBadges?.[player.id] ?? false) : false}
            slotSide={SLOT_SIDES[i]}
            isGameOver={isGameOver}
            gameOverRole={player && gameOverRoles ? gameOverRoles[player.id] : undefined}
          />
        );
      })}
      {/* Virus card overlay — renders over board during virus_resolution */}
      {virusResolvingCard && (
        <VirusCardOverlay key={virusResolvingCard.id} card={virusResolvingCard} />
      )}
      {/* Winner banner — renders over board during game_over */}
      {isGameOver && (
        <WinnerBanner winner={gameOverWinner ?? null} />
      )}
    </svg>
  );
}
