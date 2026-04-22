import { createClient } from "./client";

/**
 * Returns the current user's ID, creating an anonymous session first
 * if none exists. Enables frictionless joining — no signup required.
 *
 * Requires "Anonymous sign-ins" to be enabled in the Supabase Auth settings:
 * Dashboard → Authentication → Providers → Anonymous
 */
export async function ensureSession(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.user.id) return session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw new Error("Could not create session");

  return data.user.id;
}
