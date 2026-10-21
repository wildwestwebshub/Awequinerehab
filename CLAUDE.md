# Editing rules for awequinerehab

- Page text, photos and menu are edited by the client at /admin/ and stored in KV (`CONTENT` binding, key `content`).
  Do not hand-edit `src/content.default.json` expecting the live site to change; it is only the first-run fallback.
- Design lives in `site/assets/site.css`; page HTML is generated in `src/render.js` (same header/footer on every page).
- Admin app is the single file `site/admin/index.html`. API + routing is `src/worker.js`; login code is `src/auth.js`.
- Seed photos are in `site/images/` (max 1800 px, JPEG ~q84). Client uploads are stored in KV and served at `/uploads/<id>`.
- Secrets `ADMIN_EMAIL` / `ADMIN_PASSWORD` are set in the Cloudflare dashboard, never in the repo.
