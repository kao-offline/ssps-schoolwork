# Install website

`site/` is a static Cloudflare Worker asset deployment for `sspsmcp.kaooffline.top`. It hosts the landing page and public bootstrap scripts, never student accounts or caches.

Use the existing Cloudflare login locally; do not put credentials in source control.

```bash
npm ci --prefix site
npm --prefix site run build
node site/node_modules/wrangler/bin/wrangler.js deploy --config site/wrangler.jsonc --dry-run
npm --prefix site run deploy
```

Wrangler manages the exact custom domain in `site/wrangler.jsonc`, including DNS and TLS. Commit source before deploying: `/health.json` reports the source Git revision. Verify the domain, health revision and both installer downloads after deployment. Bootstrap updates require a clean checkout and the expected GitHub remote; they preserve modified installations.

The exact-host Worker route also takes priority over the zone's existing quickHOST wildcard route. Keep both configured so installer requests reach this site without changing other subdomains.

Rollback using a previous Cloudflare Worker deployment/version, or check out the previous source revision and deploy it again. Private credentials and user data remain outside the website.

The build copies public assets into ignored `site/build/` and pins both served bootstrap scripts to the source Git commit reported by `/health.json`. Push that commit before deployment so GitHub can serve it. Published installers download that exact release using a clean detached checkout, while local source scripts still default to `main`. This keeps the installer and website revisions aligned even while a PR remains open; deployment does not merge the PR. Reruns preserve local changes and private account data. Retain the previous Worker version as the rollback handle.
