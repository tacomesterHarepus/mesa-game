import { CreateGameForm } from "./CreateGameForm";

export default function CreateGamePage() {
  return (
    <div className="min-h-screen bg-deep flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-mono text-amber text-2xl tracking-[0.3em] uppercase">
            MESA
          </h1>
          <p className="text-muted text-xs font-mono mt-1 tracking-widest uppercase">
            New Game
          </p>
        </div>
        <div className="bg-surface border border-border rounded-lg p-6">
          <CreateGameForm />
        </div>
      </div>
    </div>
  );
}
