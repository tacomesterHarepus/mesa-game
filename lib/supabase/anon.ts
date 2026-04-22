import { createClient } from "./client";

export async function ensureSession(): Promise<{
  userId: string;
  supabase: ReturnType<typeof createClient>;
}> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user.id) return { userId: session.user.id, supabase };

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw new Error("Could not create session");

  return { userId: data.user.id, supabase };
}
