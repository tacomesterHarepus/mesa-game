// devFetch: wraps fetch with Origin: http://localhost:3000 so that
// Node.js test process calls to Supabase edge functions pass the
// origin-based dev-mode gate (browsers send Origin automatically;
// Node.js fetch does not).
export function devFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Origin: "http://localhost:3000",
    },
  });
}
