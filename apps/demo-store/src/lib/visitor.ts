const VISITOR_STORAGE_KEY = "togglewars_visitor_id";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") {
    return "ssr-anonymous";
  }

  const fromCookie = readCookie(VISITOR_STORAGE_KEY);
  if (fromCookie) {
    try {
      window.localStorage.setItem(VISITOR_STORAGE_KEY, fromCookie);
    } catch {
      // ignore storage errors
    }
    return fromCookie;
  }

  try {
    const fromStorage = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (fromStorage) {
      writeCookie(VISITOR_STORAGE_KEY, fromStorage);
      return fromStorage;
    }
  } catch {
    // ignore storage errors
  }

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `visitor-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

  try {
    window.localStorage.setItem(VISITOR_STORAGE_KEY, generated);
  } catch {
    // ignore storage errors
  }
  writeCookie(VISITOR_STORAGE_KEY, generated);
  return generated;
}
