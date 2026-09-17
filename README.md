# deckrun-slides

Markdown presentations written for [deckrun](https://github.com/arpitbbhayani/deckrun).
Every push to `main` builds each deck into a standalone HTML page and publishes it to
Cloudflare R2, where it is served from `https://sabo.sh/storage/resource/<name>.html`.

```
src/redis.md   ──build──►   dist/redis.html   ──upload──►   sabo.sh/storage/resource/redis.html
```

## Layout

| Path | What it is |
| --- | --- |
| `src/*.md` | The decks. **The filename is the URL**: `src/redis.md` → `/storage/resource/redis.html` |
| `scripts/build.mjs` | Builds each deck into a standalone presenter page in `dist/` |
| `.github/workflows/publish.yml` | Build on every push/PR, upload to R2 on pushes to `main` |
| `extras/` | One-off files that are not part of the build |
| `dist/` | Build output. Generated, git-ignored |

## Writing a deck

Slides are separated by `---` on its own line. See the
[deckrun README](https://github.com/arpitbbhayani/deckrun#slide-authoring) for the full syntax:
code fences, Mermaid diagrams, KaTeX math, image directives, `{reveal}` markers and
`<!-- notes: ... -->` speaker notes.

The first slide can set per-deck options in a comment. Anything left out uses the
defaults in `scripts/build.mjs` (theme `midnight`, template `classic`, transition `slide`):

```markdown
<!-- deckrun: theme=midnight template=classic transition=slide -->

# My Deck Title
```

Options: `theme`, `template`, `transition`, `head` (heading font), `body` (body font), `title`.
Run `npx deckrun --list-themes` (or `--list-templates`, `--list-transitions`, `--list-fonts`) to see the choices.

## Local use

```bash
npm install

npm run dev -- src/redis.md   # write in the live editor, Cmd/Ctrl+Enter to present
npm run lint                  # the same checks CI runs
npm run build                 # writes dist/*.html; open one in a browser
```

The built page is self-contained: one file, no assets beside it. Fonts, highlight.js,
KaTeX and Mermaid load from public CDNs, so viewers need to be online.

## Publishing

Pushing to `main` runs the workflow: install → build (fails on lint errors) → `aws s3 sync dist/`
into the bucket under the `resource/` prefix. Pull requests build but do not publish, and the
built pages are attached to the run as a downloadable artifact either way.

Files removed from `src/` are **not** deleted from R2 — old URLs keep working until you remove
the object by hand. To mirror the repo exactly instead, add `--delete` to the `aws s3 sync` command.

---

# One-time setup

## 1 · Create the R2 API token (the keys the workflow needs)

In the Cloudflare dashboard:

1. **R2 Object Storage** → note the **bucket name** you want to publish into (the one already
   behind `sabo.sh/storage`), and your **Account ID** (shown on the R2 overview page).
2. **R2 Object Storage → API → Manage API tokens → Create API token**.
3. Settings:
   - **Token name**: `github-actions-deckrun-slides`
   - **Permissions**: **Object Read & Write** (it does not need Admin)
   - **Specify bucket(s)**: select only your bucket
   - **TTL**: leave as forever, or set a reminder to rotate it
4. **Create API token**, then copy the three values shown **once**:
   - **Access Key ID**
   - **Secret Access Key**
   - The **S3 endpoint**, which looks like `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

> The "Token value" (a separate Cloudflare API token string) is **not** used here — the
> workflow talks to R2 over the S3 API, so it needs the Access Key ID / Secret Access Key pair.

## 2 · Add them to GitHub

Repository → **Settings → Secrets and variables → Actions**.

**Secrets** (tab "Secrets" → New repository secret):

| Name | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | Your Cloudflare account ID (the `<ACCOUNT_ID>` part of the endpoint) |
| `R2_ACCESS_KEY_ID` | Access Key ID from step 1 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key from step 1 |
| `R2_BUCKET` | The bucket name, e.g. `storage` |

**Variables** (tab "Variables" → New repository variable) — optional, these have defaults:

| Name | Default | Meaning |
| --- | --- | --- |
| `R2_PREFIX` | `resource` | Key prefix inside the bucket |
| `PUBLIC_BASE` | `https://sabo.sh/storage` | Only used to print links in the run summary |

## 3 · Check the key prefix matches your Worker

This repo assumes the Worker behind `sabo.sh/storage` **strips `/storage`** and looks the rest up
in the bucket, so the object key is `resource/redis.html` and the URL is
`https://sabo.sh/storage/resource/redis.html`.

Verify after the first successful run:

```bash
curl -I https://sabo.sh/storage/resource/redis.html    # expect 200 and text/html
```

If you get a 404, list what is actually in the bucket and compare:

```bash
npx wrangler r2 object list <bucket>          # or the dashboard's object browser
```

- Objects listed as `resource/redis.html` but the URL 404s → your Worker does **not** strip
  `/storage`. Set the repository variable `R2_PREFIX` to `storage/resource`.
- Objects listed as `storage/resource/redis.html` and the URL works → leave everything as is and
  set `R2_PREFIX` to `storage/resource` to match.

The upload sets `Content-Type: text/html; charset=utf-8` and a 5-minute cache. If your Worker
sets its own content type, make sure it passes the object's stored type through, otherwise
browsers may download the file instead of showing it.

## 4 · First run

```bash
git add -A && git commit -m "Add publishing workflow" && git push
```

Watch **Actions → Publish decks**. The run summary lists the published URL for each deck.
You can also trigger it by hand from that page (**Run workflow**) without changing any file.

## Rotating the keys

Create a new R2 API token, update the two secrets, then delete the old token in the Cloudflare
dashboard. Nothing in the repo needs to change.
