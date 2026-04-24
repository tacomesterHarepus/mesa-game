import { createClient } from "@/lib/supabase/client";

type InvokeError = { message: string; name: string; context?: unknown; [key: string]: unknown };

function isRetryableError(error: InvokeError): boolean {
  // Mode 1: TCP failure — fetch() threw, request never reached the server
  if (error.name === "FunctionsFetchError" || error.message.includes("Failed to send")) {
    return true;
  }
  // Mode 2: Relay HTTP error — infrastructure returned 5xx before reaching the function handler,
  // so no handler ran and no writes occurred
  if (error.name === "FunctionsHttpError") {
    const status = (error.context as Response | undefined)?.status;
    return status !== undefined && status >= 500;
  }
  return false;
}

// For 4xx FunctionsHttpError: FunctionsHttpError.context is the raw Response (body unconsumed).
// Read body.error and return a new error with the actual server message instead of the generic
// "Edge Function returned a non-2xx status code" wrapper.
async function withActualMessage(error: InvokeError): Promise<InvokeError> {
  if (error.name !== "FunctionsHttpError") return error;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await (error.context as Response).json() as any;
    if (typeof body?.error === "string") {
      return { ...error, message: body.error };
    }
  } catch { /* body not JSON or no error field — keep generic message */ }
  return error;
}

// Retries on two cold-start failure modes:
//   1. FunctionsFetchError: fetch() threw (TCP failure) — request never reached the server
//   2. FunctionsHttpError 5xx: relay timed out before reaching the handler — no writes occurred
// Does NOT retry 4xx — those are intentional rejections from the function handler.
// For 4xx FunctionsHttpError, reads the response body to surface the actual error message.
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
    const retryable = error !== null && isRetryableError(error as InvokeError);
    if (!retryable || attempt === maxRetries) {
      if (error !== null) {
        const richError = await withActualMessage(error as InvokeError);
        return { data, error: richError };
      }
      return { data, error: null };
    }
    await new Promise<void>((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  // unreachable: loop always returns at attempt === maxRetries
  return { data: null, error: null };
}
