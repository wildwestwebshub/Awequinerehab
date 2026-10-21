# awequinerehab.com — static site + web admin on Cloudflare

Public pages are rendered by a Cloudflare Worker from content stored in Cloudflare KV.
The client edits everything at **/admin/** with an email + password — no GitHub, no WordPress.

## One-time setup (Kate)

1. **GitHub Desktop** → create `wildwestwebshub/awequinerehab` (private). Copy everything in this folder
   (except `.dev.vars` and `node_modules`) into the repo folder → commit to **main** → push.
2. **Cloudflare** → Workers & Pages → Create → **Import a repository** → pick `awequinerehab`.
   Keep the Worker name `awequinerehab` (it must match `wrangler.jsonc`). No other settings needed.
   The first deploy automatically creates the KV storage space (binding `CONTENT`) in your Cloudflare account.
3. Worker → **Settings → Variables and Secrets → Add** (type **Secret**):
   - `ADMIN_EMAIL` = your email
   - `ADMIN_PASSWORD` = a long password (this is YOUR owner login; the client gets their own)
   Then **Deploy** again so the secrets apply.
4. Open `https://awequinerehab.<your-subdomain>.workers.dev/admin/` → sign in → **Logins** tab → **Add a login**
   for the client (their email + a temporary password). They can change it themselves after signing in.
5. Check every page on the workers.dev address. Before switching the domain, take a cPanel backup of WordPress.
6. Worker → **Domains → Add** `awequinerehab.com` and `www.awequinerehab.com`. If it says a record exists, delete only
   the old apex/www A or CNAME records. **Never touch MX or TXT.**
7. After a week, delete WordPress from hosting.

## What the client can do in /admin/
Edit text, photos, buttons, galleries, cards on every page · add/remove/reorder pages and menu items ·
change phone/email/Facebook/footer · upload photos (auto-shrunk) · restore any save from the last 90 days ·
change their own password. Changes show on the live site within about a minute.

## Notes
- Content edits live in Cloudflare KV, **not** in GitHub. `src/content.default.json` is only the starting content.
  Pushing to GitHub updates the code/design/images folder, not the client's saved text.
- Old WordPress addresses are handled: `/wp-content/uploads/...` → `/images/...`, `/wp-admin` and `/wp-login.php` → `/admin/`,
  `/services/` and `/full-width-template-theme/` → `/service-packages/`.
- Owner password lives in the Cloudflare dashboard. If the client forgets theirs, re-add the same email with a new password.
- Local testing needs `npm i` then `npx wrangler dev` (put test credentials in `.dev.vars`).
