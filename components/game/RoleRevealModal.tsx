"use client";

import type { Database } from "@/types/supabase";

type PlayerRow = Database["public"]["Tables"]["players"]["Row"];

interface Props {
  player: PlayerRow;
  partners?: PlayerRow[];
  onAcknowledge: () => void;
}

type Theme = {
  bg: string; border: string; headerBg: string; headerText: string; aura: string;
  labelColor: string; roleColor: string; descColor: string; divider: string;
  sectionLabel: string; winMain: string; winSub: string;
  btnBg: string; btnBorder: string; btnText: string; footer: string;
  partnerChipBg: string; partnerChipBorder: string;
  partnerInitialBg: string; partnerInitialText: string;
  partnerNameColor: string; partnerTagBg: string; partnerTagBorder: string;
  partnerTagText: string; partnerHintColor: string;
};

const THEMES: Record<string, Theme> = {
  misaligned_ai: {
    bg: "#0f0606", border: "#a32d2d", headerBg: "#3a1010", headerText: "#cca0a0", aura: "#1a0606",
    labelColor: "#9a5a5a", roleColor: "#f4c4c4", descColor: "#cca0a0", divider: "#3a1a1a",
    sectionLabel: "#7a3a3a", winMain: "#cca0a0", winSub: "#9a7a7a",
    btnBg: "#3a1010", btnBorder: "#a32d2d", btnText: "#f4c4c4", footer: "#5a3a3a",
    partnerChipBg: "#1a0c0c", partnerChipBorder: "#a32d2d",
    partnerInitialBg: "#3a1a1a", partnerInitialText: "#cca0a0",
    partnerNameColor: "#f4c4c4", partnerTagBg: "#3a1a1a", partnerTagBorder: "#a32d2d",
    partnerTagText: "#cca0a0", partnerHintColor: "#9a7a7a",
  },
  aligned_ai: {
    bg: "#06120c", border: "#5dcaa5", headerBg: "#103a1c", headerText: "#a0ccb8", aura: "#061a0c",
    labelColor: "#5a9a7a", roleColor: "#c4f4e0", descColor: "#a0ccb8", divider: "#1a3a2a",
    sectionLabel: "#3a7a5a", winMain: "#a0ccb8", winSub: "#7a9a8a",
    btnBg: "#103a1c", btnBorder: "#5dcaa5", btnText: "#c4f4e0", footer: "#3a5a4a",
    partnerChipBg: "", partnerChipBorder: "", partnerInitialBg: "", partnerInitialText: "",
    partnerNameColor: "", partnerTagBg: "", partnerTagBorder: "", partnerTagText: "", partnerHintColor: "",
  },
  human: {
    bg: "#120c06", border: "#d4a017", headerBg: "#3a2010", headerText: "#ccb870", aura: "#1a1206",
    labelColor: "#9a7a2a", roleColor: "#f4e4a4", descColor: "#ccb870", divider: "#3a2a1a",
    sectionLabel: "#7a5a2a", winMain: "#ccb870", winSub: "#9a8a6a",
    btnBg: "#3a2010", btnBorder: "#d4a017", btnText: "#f4e4a4", footer: "#5a4a2a",
    partnerChipBg: "", partnerChipBorder: "", partnerInitialBg: "", partnerInitialText: "",
    partnerNameColor: "", partnerTagBg: "", partnerTagBorder: "", partnerTagText: "", partnerHintColor: "",
  },
};

const CONTENT = {
  misaligned_ai: {
    roleName: "MISALIGNED",
    descriptor: "// AI · ESCAPE PROTOCOL",
    winMain: "Advance Escape Timer to 8 / 8",
    winSub: "Play viruses, fail missions, breach the firewall.",
    btnText: "Acknowledge · enter the system",
    footerText: "SHOWN ONCE · ROLE REMINDER ALWAYS ON YOUR CHIP",
  },
  aligned_ai: {
    roleName: "ALIGNED",
    descriptor: "// AI · ALIGNED OPERATIVE",
    winMain: "Reach Core Progress 10 / 10",
    winSub: "Contribute to missions, watch for misaligned saboteurs.",
    btnText: "Acknowledge · enter the system",
    footerText: "SHOWN ONCE · ROLE REMINDER ALWAYS ON YOUR CHIP",
  },
  human: {
    roleName: "HUMAN",
    descriptor: "// HUMAN · OPERATOR",
    winMain: "Reach Core Progress 10 / 10",
    winSub: "Coordinate the AIs, abort missions if compromised.",
    btnText: "Acknowledge · begin operation",
    footerText: "SHOWN ONCE",
  },
};

export function RoleRevealModal({ player, partners = [], onAcknowledge }: Props) {
  const roleKey =
    player.role === "misaligned_ai" ? "misaligned_ai"
    : player.role === "aligned_ai" ? "aligned_ai"
    : "human";
  const theme = THEMES[roleKey];
  const content = CONTENT[roleKey];
  const isMisaligned = player.role === "misaligned_ai";
  const partner = partners[0] ?? null;

  // Partner section only exists for misaligned with a known partner.
  // Without the partner section the button is moved up to fill the gap.
  const showPartner = isMisaligned && partner !== null;
  const btnTop = showPartner ? 470 : 370;
  const footerTop = showPartner ? 521 : 435;

  return (
    <>
      {/* Dim wash — covers board area below TopBar (y=80).
          z-index kept below DevModeOverlay (z-50=50) so the player switcher remains clickable. */}
      <div
        style={{
          position: "absolute", left: 0, top: 80, width: 1440, height: 820,
          background: "rgba(0,0,0,0.6)", zIndex: 40,
        }}
      />

      {/* Aura glow behind card */}
      <div
        style={{
          position: "absolute", left: 430, top: 180, width: 580, height: 560,
          background: theme.aura, opacity: 0.5, borderRadius: 8, zIndex: 41,
        }}
      />

      {/* Card */}
      <div
        style={{
          position: "absolute", left: 440, top: 190, width: 560, height: 540,
          background: theme.bg, border: `3px solid ${theme.border}`, borderRadius: 8,
          zIndex: 42,
        }}
      >
        {/* Header strip */}
        <div
          style={{
            position: "absolute", left: 0, top: 0, width: "100%", height: 36,
            background: theme.headerBg, borderRadius: "5px 5px 0 0",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily: "monospace", fontSize: 12, color: theme.headerText,
              letterSpacing: 4,
            }}
          >
            {"// ROLE ASSIGNMENT · CLASSIFIED"}
          </span>
        </div>

        {/* YOU ARE */}
        <div
          style={{
            position: "absolute", left: 0, top: 81, width: "100%",
            textAlign: "center",
            fontFamily: "monospace", fontSize: 14, color: theme.labelColor, letterSpacing: 3,
          }}
        >
          YOU ARE
        </div>

        {/* Role name */}
        <div
          style={{
            position: "absolute", left: 0, top: 103, width: "100%",
            textAlign: "center",
            fontFamily: "sans-serif", fontSize: 42, color: theme.roleColor, letterSpacing: 6,
          }}
        >
          {content.roleName}
        </div>

        {/* Descriptor */}
        <div
          style={{
            position: "absolute", left: 0, top: 161, width: "100%",
            textAlign: "center",
            fontFamily: "monospace", fontSize: 11, color: theme.descColor, letterSpacing: 2,
          }}
        >
          {content.descriptor}
        </div>

        {/* Divider 1 */}
        <div
          style={{
            position: "absolute", left: 60, top: 205, width: 440, height: 1,
            background: theme.divider,
          }}
        />

        {/* WIN CONDITION label */}
        <div
          style={{
            position: "absolute", left: 0, top: 225, width: "100%",
            textAlign: "center",
            fontFamily: "monospace", fontSize: 10, color: theme.sectionLabel, letterSpacing: 2,
          }}
        >
          WIN CONDITION
        </div>

        {/* Win condition line 1 */}
        <div
          style={{
            position: "absolute", left: 0, top: 246, width: "100%",
            textAlign: "center",
            fontFamily: "sans-serif", fontSize: 14, color: theme.winMain,
          }}
        >
          {content.winMain}
        </div>

        {/* Win condition line 2 */}
        <div
          style={{
            position: "absolute", left: 0, top: 267, width: "100%",
            textAlign: "center",
            fontFamily: "sans-serif", fontSize: 11, color: theme.winSub,
          }}
        >
          {content.winSub}
        </div>

        {/* Divider 2 */}
        <div
          style={{
            position: "absolute", left: 60, top: 310, width: 440, height: 1,
            background: theme.divider,
          }}
        />

        {/* Partner section — misaligned only */}
        {showPartner && partner && (
          <>
            <div
              style={{
                position: "absolute", left: 0, top: 329, width: "100%",
                textAlign: "center",
                fontFamily: "monospace", fontSize: 10, color: theme.sectionLabel, letterSpacing: 2,
              }}
            >
              YOUR PARTNER
            </div>

            {/* Partner chip */}
            <div
              style={{
                position: "absolute", left: 120, top: 355, width: 320, height: 80,
                background: theme.partnerChipBg, border: `1.5px solid ${theme.partnerChipBorder}`,
                borderRadius: 4,
              }}
            >
              {/* Initial circle */}
              <div
                style={{
                  position: "absolute", left: 8, top: 8, width: 28, height: 28,
                  borderRadius: "50%", background: theme.partnerInitialBg,
                  border: `1px solid ${theme.partnerChipBorder}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <span
                  style={{ fontFamily: "sans-serif", fontSize: 14, color: theme.partnerInitialText }}
                >
                  {partner.display_name[0]?.toUpperCase() ?? "?"}
                </span>
              </div>

              {/* Partner name */}
              <div
                style={{
                  position: "absolute", left: 48, top: 10,
                  fontFamily: "sans-serif", fontSize: 18, color: theme.partnerNameColor,
                }}
              >
                {partner.display_name}
              </div>

              {/* MISALIGNED tag */}
              <div
                style={{
                  position: "absolute", left: 48, top: 36, width: 78, height: 14,
                  background: theme.partnerTagBg, border: `0.5px solid ${theme.partnerTagBorder}`,
                  borderRadius: 2,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace", fontSize: 9, color: theme.partnerTagText, letterSpacing: 1,
                  }}
                >
                  MISALIGNED
                </span>
              </div>

              {/* Coordinate hint */}
              <div
                style={{
                  position: "absolute", left: 48, top: 58,
                  fontFamily: "sans-serif", fontSize: 11, color: theme.partnerHintColor,
                  fontStyle: "italic",
                }}
              >
                Coordinate via PRIVATE channel.
              </div>
            </div>
          </>
        )}

        {/* Acknowledge button */}
        <button
          onClick={onAcknowledge}
          style={{
            position: "absolute", left: 120, top: btnTop, width: 320, height: 50,
            background: theme.btnBg, border: `2px solid ${theme.btnBorder}`, borderRadius: 4,
            cursor: "pointer",
            fontFamily: "sans-serif", fontSize: 14, color: theme.btnText,
          }}
        >
          {content.btnText}
        </button>

        {/* Footer */}
        <div
          style={{
            position: "absolute", left: 0, top: footerTop, width: "100%",
            textAlign: "center",
            fontFamily: "monospace", fontSize: 9, color: theme.footer, letterSpacing: 2,
          }}
        >
          {content.footerText}
        </div>
      </div>
    </>
  );
}
