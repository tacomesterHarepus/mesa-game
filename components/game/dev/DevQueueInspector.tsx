"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface QueueRow {
  id: string;
  card_key: string;
  position: number;
  resolved: boolean;
  cascaded_from: string | null;
  being_processed: boolean;
}

interface PoolRow {
  id: string;
  card_key: string;
  position: number;
}

interface Props {
  gameId: string;
}

export function DevQueueInspector({ gameId }: Props) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [pool, setPool] = useState<PoolRow[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const fetchAll = async () => {
      const [queueRes, poolRes] = await Promise.all([
        supabase
          .from("virus_resolution_queue")
          .select("*")
          .eq("game_id", gameId)
          .order("position", { ascending: true })
          .order("id", { ascending: true }),
        supabase
          .from("virus_pool")
          .select("id, card_key, position")
          .eq("game_id", gameId)
          .order("position", { ascending: true }),
      ]);
      if (cancelled) return;
      if (queueRes.data) setQueue(queueRes.data as unknown as QueueRow[]);
      if (poolRes.data) setPool(poolRes.data as PoolRow[]);
    };

    fetchAll();

    const channel = supabase
      .channel(`dev-queue-inspector-${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "virus_resolution_queue", filter: `game_id=eq.${gameId}` },
        () => { if (!cancelled) fetchAll(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "virus_pool", filter: `game_id=eq.${gameId}` },
        () => { if (!cancelled) fetchAll(); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  // Positions that appear on more than one row — Race 1 signature
  const positionCounts = queue.reduce<Record<number, number>>((acc, r) => {
    acc[r.position] = (acc[r.position] ?? 0) + 1;
    return acc;
  }, {});
  const duplicatePositions = new Set(
    Object.entries(positionCounts)
      .filter(([, count]) => count > 1)
      .map(([pos]) => Number(pos))
  );

  const abbrev = (id: string | null) => (id ? id.slice(0, 8) : "—");

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        width: 500,
        maxHeight: 420,
        overflowY: "auto",
        background: "#111",
        border: "1px solid #333",
        borderRadius: 4,
        fontFamily: "monospace",
        fontSize: 11,
        color: "#ccc",
        zIndex: 9999,
        padding: "6px 8px",
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 4, color: "#888", letterSpacing: 1 }}>
        QUEUE ({queue.length})
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#555", borderBottom: "1px solid #2a2a2a" }}>
            <th style={{ textAlign: "left", paddingRight: 6, fontWeight: "normal" }}>pos</th>
            <th style={{ textAlign: "left", paddingRight: 6, fontWeight: "normal" }}>card</th>
            <th style={{ textAlign: "left", paddingRight: 6, fontWeight: "normal" }}>res</th>
            <th style={{ textAlign: "left", paddingRight: 6, fontWeight: "normal" }}>bp</th>
            <th style={{ textAlign: "left", fontWeight: "normal" }}>cascaded_from</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((row) => {
            const isDupe = duplicatePositions.has(row.position);
            return (
              <tr
                key={row.id}
                style={{
                  background: isDupe ? "#3a0f0f" : "transparent",
                  color: isDupe ? "#ff7070" : row.resolved ? "#444" : "#bbb",
                }}
              >
                <td style={{ paddingRight: 6 }}>{row.position}</td>
                <td style={{ paddingRight: 6 }}>{row.card_key}</td>
                <td style={{ paddingRight: 6 }}>{row.resolved ? "✓" : "·"}</td>
                <td style={{ paddingRight: 6 }}>{row.being_processed ? "⚑" : "·"}</td>
                <td style={{ color: isDupe ? "#ff7070" : row.cascaded_from ? "#8888cc" : "#333" }}>
                  {abbrev(row.cascaded_from)}
                </td>
              </tr>
            );
          })}
          {queue.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "#333", paddingTop: 2 }}>empty</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ fontWeight: "bold", marginTop: 8, marginBottom: 3, color: "#888", letterSpacing: 1 }}>
        POOL ({pool.length})
      </div>
      {pool.length === 0 ? (
        <div style={{ color: "#333" }}>empty</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {pool.map((row) => (
            <span key={row.id} style={{ color: "#6699aa" }}>
              {row.position}:{row.card_key}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
