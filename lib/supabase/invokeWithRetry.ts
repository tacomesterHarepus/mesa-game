import { createClient } from "@/lib/supabase/client";

type InvokeError = { message: string; name: string; [key: string]: unknown };

function isNetworkError(error: InvokeError): boolean {
  return (
    error.name === "FunctionsFetchError" ||
    error.message.includes("Failed to send")
  );
}

// Only retries on network-level failures where no server-side writes occurred.
// Safe for non-idempotent operations like play-card because fetch throwing means
// the request never reached the server — the cold-start container wasn't ready
// to accept connections, so no handler ran.
//
// Matches @supabase/functions-js convention: data type defaults to any so callers
// can access dynamic server-response properties (e.g. data?.error) without casts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeWithRetry<T = any>(
  fnName: string,
  body: Record<string, unknown>,
  maxRetries = 2,
): Promise<{ data: T | null; error: InvokeError | null }> {
  const supabase = createClient();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.functions.invoke<T>(fnName, { body });
    const retryable = error !== null && isNetworkError(error as InvokeError);
    if (!retryable || attempt === maxRetries) {
      return { data, error: error as InvokeError | null };
    }
    await new Promise<void>((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  // unreachable: loop always returns at attempt === maxRetries
  return { data: null, error: null };
}
