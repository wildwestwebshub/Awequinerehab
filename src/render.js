// Builds public HTML pages from the content JSON. No framework, no build step.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Only allow safe link / image targets.
export function safeUrl(u) {
  u = String(u ?? "").trim();
  if (!u) return "";
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  if (u.startsWith("#")) return u;
  return "";
}

const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li", "h3", "h4", "blockquote"]);

// Small allow-list sanitizer for the rich text the client types in the admin.
export function sanitizeHtml(html) {
  html = String(html ?? "");
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1\s*>/gi, "");
  return html.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (m, slash, tag, rest) => {
    tag = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (slash) return `</${tag}>`;
    if (tag === "a") {
      const h = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(rest);
      const href = safeUrl(h ? (h[2] ?? h[3]).replace(/&amp;/g, "&") : "");
      if (!href) return "<a>";
      const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${esc(href)}"${ext}>`;
    }
    return `<${tag}>`;
  });
}

const alignClass = (a) => (a === "center" ? " t-center" : a === "right" ? " t-right" : "");

function img(src, alt, extra = "") {
  src = safeUrl(src);
  if (!src) return "";
  return `<img src="${esc(src)}" alt="${esc(alt || "")}" loading="lazy" decoding="async"${extra}>`;
}

function renderBlock(b) {
  switch (b.type) {
    case "heading": {
      const lvl = b.level === 3 ? 3 : 2;
      return `<h${lvl} class="blk-heading${alignClass(b.align)}">${esc(b.text)}</h${lvl}>`;
    }
    case "text":
      return `<div class="blk-text${alignClass(b.align)}">${sanitizeHtml(b.html)}</div>`;
    case "image": {
      const i = img(b.src, b.alt);
      if (!i) return "";
      const cap = b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : "";
      return `<figure class="blk-image ${b.width === "medium" ? "medium" : "full"}">${i}${cap}</figure>`;
    }
    case "list": {
      const items = (b.items || []).filter((x) => String(x).trim()).map((x) => `<li>${esc(x)}</li>`).join("");
      return `<ul class="blk-list">${items}</ul>`;
    }
    case "button": {
      const url = safeUrl(b.url);
      if (!url || !b.label) return "";
      const ext = /^https?:/i.test(url) ? ' target="_blank" rel="noopener"' : "";
      return `<p class="blk-button${alignClass(b.align)}"><a class="btn ${b.style === "outline" ? "btn-outline" : "btn-solid"}" href="${esc(url)}"${ext}>${esc(b.label)}</a></p>`;
    }
    case "cards": {
      const items = (b.items || [])
        .map((c) => {
          const link = safeUrl(c.linkUrl);
          const more = link && c.linkLabel ? `<p><a class="btn btn-outline" href="${esc(link)}">${esc(c.linkLabel)}</a></p>` : "";
          return `<article class="card">${img(c.image, c.title)}<div class="card-body"><h3>${esc(c.title)}</h3>${sanitizeHtml(c.html)}${more}</div></article>`;
        })
        .join("");
      return `<div class="blk-cards">${items}</div>`;
    }
    case "split": {
      const link = safeUrl(b.buttonUrl);
      const btn = link && b.buttonLabel ? `<p><a class="btn btn-solid" href="${esc(link)}">${esc(b.buttonLabel)}</a></p>` : "";
      return `<section class="blk-split ${b.imageSide === "right" ? "img-right" : ""}"><div class="split-img">${img(b.image, b.title)}</div><div class="split-text">${b.title ? `<h2>${esc(b.title)}</h2>` : ""}${sanitizeHtml(b.html)}${btn}</div></section>`;
    }
    case "gallery": {
      const items = (b.images || [])
        .map((g) => {
          const s = safeUrl(g.src);
          return s ? `<a href="${esc(s)}" data-lightbox><img src="${esc(s)}" alt="${esc(g.alt || "")}" loading="lazy" decoding="async"></a>` : "";
        })
        .join("");
      return `<div class="blk-gallery">${items}</div>`;
    }
    case "embed":
      return renderEmbed(b);
    case "divider":
      return `<hr class="blk-divider">`;
    default:
      return "";
  }
}

// Embeds are limited to Facebook, YouTube and Google Maps, so a pasted address can never inject anything else.
function renderEmbed(b) {
  const h = Math.min(Math.max(parseInt(b.height, 10) || 600, 200), 1200);
  const url = String(b.url || "").trim();
  if (!url) return "";
  if (b.kind === "facebook") {
    let u;
    try { u = new URL(url); } catch { return ""; }
    if (!/(^|\.)facebook\.com$/i.test(u.hostname) || u.protocol !== "https:") return "";
    const src = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(u.href)}&tabs=timeline&width=500&height=${h}&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=true`;
    return `<div class="blk-embed fb"><iframe src="${esc(src)}" width="500" height="${h}" style="border:0;overflow:hidden" loading="lazy" allow="encrypted-media" title="Facebook feed"></iframe><p class="fb-link"><a href="${esc(u.href)}" target="_blank" rel="noopener">Open our Facebook page</a></p></div>`;
  }
  if (b.kind === "file") {
    // Self-hosted video from the site's /video/ folder (or a client upload).
    if (!/^\/(video|uploads)\/[\w./-]+$/.test(url) || url.includes("..")) return "";
    const poster = safeUrl(b.poster);
    return `<div class="blk-embed video file"><video controls playsinline preload="metadata"${poster ? ` poster="${esc(poster)}"` : ""}><source src="${esc(url)}" type="video/mp4">Your browser can't play this video. <a href="${esc(url)}">Download it</a>.</video></div>`;
  }
  if (b.kind === "youtube") {
    const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{11})/.exec(url);
    if (!m) return "";
    return `<div class="blk-embed video"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" loading="lazy" allowfullscreen title="Video"></iframe></div>`;
  }
  if (b.kind === "map") {
    const src = `https://maps.google.com/maps?q=${encodeURIComponent(url)}&output=embed`;
    return `<div class="blk-embed map"><iframe src="${esc(src)}" loading="lazy" title="Map" style="height:${Math.min(h, 600)}px"></iframe></div>`;
  }
  return "";
}

// Full-width photo band with a title over it (like a magazine section break).
function renderBanner(b) {
  const bg = safeUrl(b.image);
  if (!bg) return "";
  const link = safeUrl(b.buttonUrl);
  const btn = link && b.buttonLabel ? `<p><a class="btn btn-solid" href="${esc(link)}">${esc(b.buttonLabel)}</a></p>` : "";
  return `<section class="banner" style="background-image:url('${esc(bg)}')"><div class="banner-in">${b.title ? `<h2>${esc(b.title)}</h2>` : ""}${b.text ? `<p class="banner-text">${esc(b.text)}</p>` : ""}${btn}</div></section>`;
}

export function pagePath(p) {
  return p.slug ? `/${p.slug}/` : "/";
}

function telHref(phone) {
  const d = String(phone || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  return "tel:" + (d.startsWith("+") ? d : d.length === 10 ? "+1" + d : "+" + d);
}

function layout(content, page, origin, body) {
  const s = content.settings || {};
  const nav = content.pages
    .filter((p) => p.nav)
    .map((p) => `<a href="${esc(pagePath(p))}"${p.id === page.id ? ' aria-current="page"' : ""}>${esc(p.navLabel || p.title)}</a>`)
    .join("");
  const tel = telHref(s.phone);
  const cta = tel && s.ctaLabel ? `<a class="btn btn-outline hdr-cta" href="${esc(tel)}">${esc(s.ctaLabel)}</a>` : "";
  const title = page.slug === "" ? `${s.siteName} – ${s.tagline}` : `${page.title} – ${s.siteName}`;
  const desc = page.metaDescription || s.tagline || "";
  const canon = origin + pagePath(page);
  const og = page.hero && page.hero.image ? origin + page.hero.image : "";
  const foot = content.pages.filter((p) => p.nav).map((p) => `<a href="${esc(pagePath(p))}">${esc(p.navLabel || p.title)}</a>`).join("");
  const contactLines = [
    s.phone && tel ? `<a href="${esc(tel)}">${esc(s.phone)}</a>` : "",
    s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : "",
    s.address ? `<span>${esc(s.address)}</span>` : "",
    safeUrl(s.facebook) ? `<a href="${esc(safeUrl(s.facebook))}" target="_blank" rel="noopener">Facebook</a>` : "",
  ].filter(Boolean).join("");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canon)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(canon)}">${og ? `<meta property="og:image" content="${esc(og)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/assets/site.css">
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="hdr"><div class="hdr-in">
<a class="brand" href="/">${esc(s.siteName)}</a>
<input type="checkbox" id="navtoggle" class="navtoggle" aria-label="Menu"><label for="navtoggle" class="burger" aria-hidden="true"><span></span></label>
<nav class="nav">${nav}${cta.replace("hdr-cta", "hdr-cta in-nav")}</nav>
${cta}
</div></header>
<main id="main">${body}</main>
<footer class="ftr"><div class="ftr-in">
<div><strong>${esc(s.siteName)}</strong><p>${esc(s.footerText)}</p></div>
<div class="ftr-links">${foot}</div>
<div class="ftr-links">${contactLines}</div>
</div><p class="copy">Copyright © ${new Date().getUTCFullYear()} | ${esc(s.siteName)}</p></footer>
<script src="/assets/site.js" defer></script>
</body></html>`;
}

export function renderPage(content, page, origin) {
  const h = page.hero || {};
  let hero = "";
  if (h.show) {
    const bg = safeUrl(h.image);
    const big = h.size === "big";
    hero = `<section class="hero ${big ? "hero-big" : "hero-small"}${bg ? " has-img" : ""}${h.overlay === "light" ? " hero-light" : ""}"${bg ? ` style="background-image:url('${esc(bg)}')"` : ""}><div class="hero-in"><h1>${esc(h.title || page.title)}</h1>${h.subtitle ? `<p>${esc(h.subtitle)}</p>` : ""}</div></section>`;
  }
  const BG = new Set(["none", "cream", "sand", "maroon", "navy"]);
  const bands = [];
  for (const b of page.blocks || []) {
    if (b.type === "banner") {
      const html = renderBanner(b);
      if (html) bands.push({ banner: html });
      continue;
    }
    const bg = BG.has(b.bg) ? b.bg : "none";
    const last = bands[bands.length - 1];
    if (last && !last.banner && last.bg === bg) last.html.push(renderBlock(b));
    else bands.push({ bg, html: [renderBlock(b)] });
  }
  if (!bands.length) bands.push({ bg: "none", html: [] });
  const title = h.show ? "" : `<h1 class="plain-title">${esc(page.title)}</h1>`;
  const body = bands.map((band, i) => band.banner || `<section class="band bg-${band.bg}"><div class="wrap">${i === 0 ? title : ""}${band.html.join("\n")}</div></section>`).join("\n");
  return layout(content, page, origin, hero + body);
}

export function renderNotFound(content, origin) {
  const page = { id: "404", slug: "404", title: "Page not found", hero: { show: false } };
  const body = `<section class="band bg-cream"><div class="wrap t-center"><h1 class="plain-title">Page not found</h1><p>Sorry, we couldn't find that page.</p><p><a class="btn btn-solid" href="/">Back to home</a></p></div></section>`;
  return layout(content, page, origin, body);
}

export function renderSitemap(content, origin) {
  const urls = content.pages.filter((p) => p.id !== "404").map((p) => `<url><loc>${esc(origin + pagePath(p))}</loc></url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
