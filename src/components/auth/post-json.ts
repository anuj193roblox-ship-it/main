// Browser helper for the auth routes. Same-origin fetch: the browser adds the Origin header.

export type PostResult = { ok: boolean; status: number; data: Record<string, unknown> };

const OFFLINE = "You seem to be offline. Check your connection and try again.";
const UNKNOWN = "Something went wrong on our side. Try again in a few minutes.";

export function postJson(url: string, body: unknown = {}): Promise<PostResult> {
  return sendJson("POST", url, body);
}

export async function sendJson(method: "POST" | "PATCH" | "DELETE", url: string, body: unknown = {}): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: OFFLINE } };
  }
}

/** The server's message, or a generic one. Never raw errors. */
export function errorText(result: PostResult): string {
  return typeof result.data.error === "string" ? result.data.error : UNKNOWN;
}

/** Only follow internal paths the server returned. */
export function goTo(path: unknown, fallback = "/app/today") {
  const target = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? path : fallback;
  window.location.assign(target);
}
