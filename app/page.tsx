import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-deep flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="font-mono text-amber text-2xl tracking-[0.3em] uppercase mb-1">
          MESA
        </h1>
        <p className="text-muted text-xs font-mono mb-10 tracking-widest uppercase">
          Social Deduction Protocol
        </p>
        <Link href="/game/create" className="block">
          <Button className="w-full">New Game</Button>
        </Link>
        <p className="mt-8 text-faint text-xs font-mono">{user.email}</p>
      </div>
    </div>
  );
}
