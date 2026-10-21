// Login, sessions and user accounts. Everything lives in the CONTENT KV namespace.

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const SESSION_DAYS = 30;
const COOKIE = "aw_session";

async function pbkdf2(password, saltB64) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: 100000 }, key, 256);
  return b64(bits);
}

export async function makeUser(email, password) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { email: email.trim().toLowerCase(), salt, hash: await pbkdf2(password, salt), created: new Date().toISOString() };
}

function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function getUsers(env) {
  return (await env.CONTENT.get("sys:users", "json")) || [];
}

async function sessionKey(env) {
  let k = await env.CONTENT.get("sys:sessionkey");
  if (!k) {
    k = b64(crypto.getRandomValues(new Uint8Array(32)));
    await env.CONTENT.put("sys:sessionkey", k);
  }
  return crypto.subtle.importKey("raw", unb64(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(env, payload) {
  const key = await sessionKey(env);
  const body = btoa(JSON.stringify(payload));
  const sig = b64(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${sig}`;
}

export async function getSession(req, env) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get("cookie") || "");
  if (!m) return null;
  const [body, sig] = decodeURIComponent(m[1]).split(".");
  if (!body || !sig) return null;
  try {
    const key = await sessionKey(env);
    const ok = await crypto.subtle.verify("HMAC", key, unb64(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(atob(body));
    if (!p.exp || p.exp < Date.now()) return null;
    // A removed user is logged out immediately.
    if (p.role !== "owner") {
      const users = await getUsers(env);
      if (!users.some((u) => u.email === p.email)) return null;
    }
    return p;
  } catch {
    return null;
  }
}

export async function attemptLogin(req, env, email, password) {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const rlKey = `sys:rl:${ip}`;
  const tries = parseInt((await env.CONTENT.get(rlKey)) || "0", 10);
  if (tries >= 10) return { error: "Too many attempts. Please wait 15 minutes and try again.", status: 429 };

  email = String(email || "").trim().toLowerCase();
  password = String(password || "");
  let role = null;

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD && email === String(env.ADMIN_EMAIL).trim().toLowerCase()) {
    if (safeEqual(password, env.ADMIN_PASSWORD)) role = "owner";
  }
  if (!role) {
    const u = (await getUsers(env)).find((x) => x.email === email);
    if (u && safeEqual(await pbkdf2(password, u.salt), u.hash)) role = "editor";
  }
  if (!role) {
    await env.CONTENT.put(rlKey, String(tries + 1), { expirationTtl: 900 });
    return { error: "That email or password isn't right.", status: 401 };
  }
  await env.CONTENT.delete(rlKey);
  const token = await sign(env, { email, role, exp: Date.now() + SESSION_DAYS * 864e5 });
  const cookie = `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
  return { cookie, role, email };
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function changePassword(env, email, current, next) {
  const users = await getUsers(env);
  const i = users.findIndex((u) => u.email === email);
  if (i < 0) return "Your password is managed in the Cloudflare dashboard (owner account).";
  if (!safeEqual(await pbkdf2(String(current || ""), users[i].salt), users[i].hash)) return "Your current password isn't right.";
  if (String(next || "").length < 10) return "New password must be at least 10 characters.";
  users[i] = await makeUser(email, next);
  await env.CONTENT.put("sys:users", JSON.stringify(users));
  return null;
}
