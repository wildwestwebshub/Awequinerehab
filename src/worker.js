import defaults from "./content.default.json";
import { renderPage, renderNotFound, renderSitemap, pagePath } from "./render.js";
import { attemptLogin, clearCookie, getSession, getUsers, makeUser, changePassword } from "./auth.js";

const RESERVED = new Set(["admin", "api", "assets", "images", "uploads", "wp-admin", "wp-content", "wp-json", "sitemap.xml", "robots.txt", "feed"]);
const BLOCK_TYPES = new Set(["heading", "text", "image", "list", "button", "cards", "split", "gallery", "embed", "divider"]);
const BG_VALUES = new Set(["none", "cream", "sand", "maroon", "navy"]);
const MAX_UPLOAD = 6 * 1024 * 1024;
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

async function loadContent(env) {
  const saved = await env.CONTENT.get("content", "json");
  return saved && saved.pages ? saved : defaults;
}

// ---------- validation so a bad save can never break the public site ----------
const str = (v, max = 5000) => String(v ?? "").slice(0, max);

function normalize(input) {
  if (!input || !Array.isArray(input.pages) || input.pages.length === 0) throw new Error("No pages found.");
  const s = input.settings || {};
  const settings = {};
  for (const k of ["siteName", "tagline", "phone", "email", "facebook", "address", "footerText", "ctaLabel"]) settings[k] = str(s[k], 300);
  if (!settings.siteName.trim()) throw new Error("Site name can't be empty.");

  const seen = new Set();
  let home = 0;
  const pages = input.pages.map((p, idx) => {
    let slug = str(p.slug, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (p.id === "home" || (p.slug === "" && !home)) slug = "";
    if (slug === "") home++;
    if (RESERVED.has(slug)) throw new Error(`"${slug}" can't be used as a page address.`);
    if (seen.has(slug)) throw new Error(`Two pages use the address "${slug || "(home)"}".`);
    seen.add(slug);
    const h = p.hero || {};
    return {
      id: str(p.id || "p" + Date.now().toString(36) + idx, 40).replace(/[^\w-]/g, ""),
      slug,
      title: str(p.title, 200) || "Untitled",
      nav: !!p.nav,
      navLabel: str(p.navLabel, 60) || str(p.title, 60),
      metaDescription: str(p.metaDescription, 300),
      hero: { show: !!h.show, image: str(h.image, 400), title: str(h.title, 200), subtitle: str(h.subtitle, 400), size: h.size === "big" ? "big" : "small" },
      blocks: (Array.isArray(p.blocks) ? p.blocks : []).slice(0, 200).filter((b) => b && BLOCK_TYPES.has(b.type)).map((b, i) => {
        const out = JSON.parse(JSON.stringify(b));
        out.id = str(b.id || "b" + Date.now().toString(36) + i, 40).replace(/[^\w-]/g, "");
        out.bg = BG_VALUES.has(b.bg) ? b.bg : "none";
        return out;
      }),
    };
  });
  if (home !== 1) throw new Error("There must be exactly one Home page.");
  const json = JSON.stringify({ settings, pages });
  if (json.length > 400000) throw new Error("That's too much content for one save.");
  return { settings, pages };
}

// ---------- API ----------
async function api(req, env, url) {
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/login" && method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const r = await attemptLogin(req, env, b.email, b.password);
    if (r.error) return json({ error: r.error }, r.status);
    return json({ ok: true, role: r.role, email: r.email }, 200, { "set-cookie": r.cookie });
  }
  if (path === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "set-cookie": clearCookie });

  const me = await getSession(req, env);
  if (path === "/api/me") return me ? json({ email: me.email, role: me.role }) : json({ error: "Not signed in" }, 401);
  if (!me) return json({ error: "Please sign in." }, 401);
  if (method !== "GET" && req.headers.get("x-requested-with") !== "aw-admin") return json({ error: "Bad request" }, 400);

  if (path === "/api/content" && method === "GET") return json(await loadContent(env));

  if (path === "/api/content" && method === "PUT") {
    let clean;
    try { clean = normalize(await req.json()); } catch (e) { return json({ error: e.message || "Could not save." }, 400); }
    // Keep the previous version (or the original migrated site on the very first save) so it can be restored.
    const prev = (await env.CONTENT.get("content")) || JSON.stringify(defaults);
    await env.CONTENT.put(`rev:${new Date().toISOString()}`, prev, { expirationTtl: 90 * 86400, metadata: { by: me.email } });
    await env.CONTENT.put("content", JSON.stringify(clean));
    return json({ ok: true, content: clean });
  }

  if (path === "/api/revisions" && method === "GET") {
    const l = await env.CONTENT.list({ prefix: "rev:", limit: 100 });
    const items = l.keys.map((k) => ({ id: k.name, when: k.name.slice(4), by: k.metadata && k.metadata.by })).reverse().slice(0, 25);
    return json({ items });
  }
  if (path === "/api/revisions/restore" && method === "POST") {
    const { id } = await req.json();
    if (!/^rev:/.test(String(id))) return json({ error: "Bad request" }, 400);
    const old = await env.CONTENT.get(id);
    if (!old) return json({ error: "That version is no longer available." }, 404);
    const cur = await env.CONTENT.get("content");
    if (cur) await env.CONTENT.put(`rev:${new Date().toISOString()}`, cur, { expirationTtl: 90 * 86400, metadata: { by: me.email } });
    await env.CONTENT.put("content", old);
    return json({ ok: true, content: JSON.parse(old) });
  }

  if (path === "/api/media" && method === "GET") {
    let manifest = [];
    try {
      const r = await env.ASSETS.fetch(new Request(url.origin + "/images/manifest.json"));
      if (r.ok) manifest = await r.json();
    } catch {}
    const l = await env.CONTENT.list({ prefix: "img:", limit: 1000 });
    const uploads = l.keys.map((k) => ({ id: k.name, src: "/uploads/" + k.name.slice(4), name: (k.metadata && k.metadata.name) || k.name.slice(4), uploaded: true }));
    return json({ site: manifest, uploads });
  }
  if (path === "/api/upload" && method === "POST") {
    const type = (req.headers.get("content-type") || "").split(";")[0];
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[type];
    if (!ext) return json({ error: "Please upload a JPG, PNG, WebP or GIF picture." }, 400);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_UPLOAD) return json({ error: "That picture is too big (6 MB max)." }, 413);
    const name = decodeURIComponent(req.headers.get("x-filename") || "photo").replace(/[^\w .()-]/g, "").slice(0, 80);
    const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
    await env.CONTENT.put(`img:${id}`, buf, { metadata: { name, type, size: buf.byteLength } });
    return json({ ok: true, src: "/uploads/" + id, name });
  }
  if (path.startsWith("/api/media/") && method === "DELETE") {
    const id = decodeURIComponent(path.slice(11));
    if (!/^[\w.-]+$/.test(id)) return json({ error: "Bad request" }, 400);
    await env.CONTENT.delete("img:" + id);
    return json({ ok: true });
  }

  if (path === "/api/password" && method === "POST") {
    const b = await req.json();
    const err = await changePassword(env, me.email, b.current, b.next);
    return err ? json({ error: err }, 400) : json({ ok: true });
  }

  if (path === "/api/users") {
    if (me.role !== "owner") return json({ error: "Only the site owner can manage logins." }, 403);
    if (method === "GET") return json({ users: (await getUsers(env)).map((u) => ({ email: u.email, created: u.created })) });
    if (method === "POST") {
      const b = await req.json();
      const email = String(b.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (String(b.password || "").length < 10) return json({ error: "Password must be at least 10 characters." }, 400);
      const users = (await getUsers(env)).filter((u) => u.email !== email);
      users.push(await makeUser(email, b.password));
      await env.CONTENT.put("sys:users", JSON.stringify(users));
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const email = String(url.searchParams.get("email") || "").toLowerCase();
      await env.CONTENT.put("sys:users", JSON.stringify((await getUsers(env)).filter((u) => u.email !== email)));
      return json({ ok: true });
    }
  }
  return json({ error: "Not found" }, 404);
}

// ---------- public site ----------
const stripWpSize = (p) => p.replace(/-\d+x\d+(\.[a-z]+)$/i, "$1").replace(/-scaled(\.[a-z]+)$/i, "$1");

export default {
  async fetch(req, env) {
    if (!env.CONTENT) return new Response("Setup incomplete: the CONTENT KV binding is missing. See README.md.", { status: 500 });
    const url = new URL(req.url);
    let path = url.pathname;

    if (path.startsWith("/api/")) return api(req, env, url);

    if (path === "/admin") return Response.redirect(url.origin + "/admin/", 301);
    if (path.startsWith("/admin/")) {
      const r = await env.ASSETS.fetch(req);
      const h = new Headers(r.headers);
      h.set("cache-control", "no-store");
      h.set("x-robots-tag", "noindex, nofollow");
      return new Response(r.body, { status: r.status, headers: h });
    }

    // Old WordPress addresses
    if (path.startsWith("/wp-admin") || path === "/wp-login.php") return Response.redirect(url.origin + "/admin/", 302);
    if (path.startsWith("/wp-content/uploads/")) {
      const rest = stripWpSize(path.slice("/wp-content/uploads/".length));
      return Response.redirect(`${url.origin}/images/${rest.replace(/\.png$/i, ".jpg")}`, 301);
    }
    if (path === "/services/" || path === "/services" || path.startsWith("/full-width-template-theme")) return Response.redirect(url.origin + "/service-packages/", 301);
    if (path.startsWith("/feed") || path.startsWith("/category/") || path.startsWith("/hello-world")) return Response.redirect(url.origin + "/", 301);

    if (path.startsWith("/uploads/")) {
      const id = decodeURIComponent(path.slice(9));
      const { value, metadata } = await env.CONTENT.getWithMetadata("img:" + id, "arrayBuffer");
      if (!value) return new Response("Not found", { status: 404 });
      return new Response(value, { headers: { "content-type": (metadata && metadata.type) || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
    }

    if (path.startsWith("/assets/") || path.startsWith("/images/") || path.startsWith("/video/")) return env.ASSETS.fetch(req);

    if (path === "/robots.txt") return new Response(`User-agent: *\nDisallow: /admin/\nSitemap: ${url.origin}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });

    const content = await loadContent(env);
    if (path === "/sitemap.xml") return new Response(renderSitemap(content, url.origin), { headers: { "content-type": "application/xml" } });

    if (path !== "/" && !path.endsWith("/")) return Response.redirect(url.origin + path + "/", 301);
    const slug = path.replace(/^\/+|\/+$/g, "");
    const page = content.pages.find((p) => p.slug === slug);
    const html = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" };
    if (!page || slug.includes("/")) return new Response(renderNotFound(content, url.origin), { status: 404, headers: html });
    return new Response(renderPage(content, page, url.origin), { headers: html });
  },
};
