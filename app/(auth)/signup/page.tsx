"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function SignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName.trim() },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-6">
      <h2 className="label-caps mb-6">Create account</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Display name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={20}
          placeholder="Shown to other players"
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete="new-password"
        />
        {error && (
          <p className="text-virus text-xs font-mono">{error}</p>
        )}
        <Button type="submit" loading={loading} className="w-full mt-2">
          Create account
        </Button>
      </form>
      <p className="mt-4 text-center text-muted text-xs">
        Have an account?{" "}
        <Link
          href="/login"
          className="text-amber hover:text-amber-dim transition-colors"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
