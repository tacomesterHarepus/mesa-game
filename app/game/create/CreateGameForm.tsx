"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/anon";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function CreateGameForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
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
    </form>
  );
}
