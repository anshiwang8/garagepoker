/**
 * The random per-browser player token (SPEC §4). It owns your seat, so a
 * refresh keeps it. Stored in localStorage and a cookie; never shown.
 */
const KEY = "gp_token";
const VALID = /^[A-Za-z0-9_-]{16,64}$/;

function readCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)gp_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function getPlayerToken(): string {
  let token: string | null = null;
  try {
    token = localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked (private mode); fall back to the cookie.
  }
  if (!token || !VALID.test(token)) token = readCookie();
  if (!token || !VALID.test(token)) token = newToken();
  try {
    localStorage.setItem(KEY, token);
  } catch {}
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${KEY}=${encodeURIComponent(token)}; path=/; max-age=31536000; SameSite=Lax${secure}`;
  return token;
}

const NICK_KEY = "gp_nickname";

export function savedNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICK_KEY, name);
  } catch {}
}
