/**
 * The random per-browser player token (SPEC §4). It owns your seat, so a
 * refresh keeps it. Stored in localStorage and a cookie; never shown.
 *
 * Every storage access is guarded: Safari can throw on localStorage (private
 * mode, blocked storage) and on document.cookie (sandboxed contexts). If both
 * fail, the token lives in memory for this page session: the page still
 * works, but a refresh gets a new token.
 */
const KEY = "gp_token";
const NICK_KEY = "gp_nickname";
const VALID = /^[A-Za-z0-9_-]{16,64}$/;

/** In-memory fallback when storage is unavailable. */
const memory: Record<string, string> = {};

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked or full; the memory copy still works for this session.
  }
}

function readCookie(key: string): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`));
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}

function writeCookie(key: string, value: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax${secure}`;
  } catch {
    // Cookies blocked; fine.
  }
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  try {
    window.crypto.getRandomValues(bytes);
    return bytes;
  } catch {
    // No Web Crypto: the token only needs to be unguessable enough for a
    // home game, but say so loudly rather than silently weaken it.
    throw new Error("This browser has no secure random number generator (crypto.getRandomValues).");
  }
}

function newToken(): string {
  let s = "";
  for (const b of randomBytes(24)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function getPlayerToken(): string {
  const candidates = [memory[KEY], readLocal(KEY), readCookie(KEY)];
  let token = candidates.find((t): t is string => !!t && VALID.test(t)) ?? newToken();
  if (!VALID.test(token)) token = newToken();
  memory[KEY] = token;
  writeLocal(KEY, token);
  writeCookie(KEY, token);
  return token;
}

export function savedNickname(): string {
  return memory[NICK_KEY] ?? readLocal(NICK_KEY) ?? "";
}

export function saveNickname(name: string): void {
  memory[NICK_KEY] = name;
  writeLocal(NICK_KEY, name);
}
