"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/anon";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const IS_DEV = process.env.NODE_ENV !== "production";

export function CreateGameForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const userId = await ensureSession();
      const supabase = createClient();

      const { data: game, error: gameError } = await supabase
        .from("games")
        .insert({ host_user_id: userId })
        .select()
        .single();

      if (gameError || !game) {
        setError(gameError?.message ?? "Failed to create game");
        setLoading(false);
        return;
      }

      const { error: playerError } = await supabase.from("players").insert({
        game_id: game.id,
        user_id: userId,
        display_name: displayName.trim(),
      });

      if (playerError) {
        setError(playerError.message);
        setLoading(false);
        return;
      }

      router.push(`/game/${game.id}/lobby`);
    } catch {
      setError("Failed to create session. Please try again.");
      setLoading(false);
    }
  }

  async function handleDevFill() {
    if (!IS_DEV) return;
    setError(null);
    setDevLoading(true);

    try {
      const userId = await ensureSession();
      const supabase = createClient();

      const { data: game, error: gameError } = await supabase
        .from("games")
        .insert({ host_user_id: userId })
        .select()
        .single();

      if (gameError || !game) {
        setError(gameError?.message ?? "Failed to create game");
        setDevLoading(false);
        return;
      }

      const hostName = displayName.trim() || "Bot1";
      const botNames = [hostName, "Bot2", "Bot3", "Bot4", "Bot5", "Bot6"];
      const inserts = botNames.map((name) => ({
        game_id: game.id,
        user_id: userId,
        display_name: name,
      }));

      const { error: playersError } = await supabase.from("players").insert(inserts);
      if (playersError) {
        setError(playersError.message);
        setDevLoading(false);
        return;
      }

      router.push(`/game/${game.id}/lobby?dev_mode=true`);
    } catch {
      setError("Failed to create dev session. Please try again.");
      setDevLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="label-caps">Your display name</h2>
      <Input
        label="Display name"
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
        maxLength={20}
        placeholder="Shown to other players"
      />
      {error && <p className="text-virus text-xs font-mono">{error}</p>}
      <Button type="submit" loading={loading} className="w-full mt-2">
        Create Game
      </Button>
      {IS_DEV && (
        <Button
          type="button"
          loading={devLoading}
          onClick={handleDevFill}
          className="w-full mt-1 opacity-70 border-dashed"
          variant="secondary"
        >
          Dev Mode: Fill Lobby
        </Button>
      )}
    </form>
  );
}
