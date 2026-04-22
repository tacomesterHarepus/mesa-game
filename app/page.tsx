import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function Home() {
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
        <p className="mt-5 text-faint text-xs font-mono leading-relaxed">
          To join or watch, use the link your host shared.
        </p>
      </div>
    </div>
  );
}
