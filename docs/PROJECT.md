# Potli

> _Potli_ (पोटली): a small cloth bundle you tie up and carry. Drop pages in; Potli sorts them.

One click saves the current page and files it into your own categories automatically. Your saves sync across browsers and devices, and you manage everything at **usepotli.com**.

- **Audience:** developers first, everyone else supported.
- **Browsers:** Chromium (Chrome, Edge, Brave), Firefox, Safari.
- **Platform:** Cloudflare only, kept within the free tier.

---

## Stack

| Part                | Tech                                                            |
| ------------------- | --------------------------------------------------------------- |
| Monorepo            | Bun workspaces                                                  |
| Extension           | WXT + Preact + TypeScript, Manifest V3                          |
| Website + dashboard | Astro (static pages) + Preact (dashboard at `/app`)             |
| API                 | Hono on Cloudflare Workers                                      |
| Database            | Cloudflare D1 + Drizzle ORM                                     |
| Validation          | zod (schemas live in `packages/shared`)                         |
| Classification      | TypeSafe AI Jev (`jev-latest`), behind a `Classifier` interface |

## Repo layout

```
apps/
  extension/   WXT: builds chrome, firefox, safari
  web/         Astro: marketing pages + /app dashboard
  api/         Hono Worker: /api/*, also serves web's static build
packages/
  shared/      types, zod schemas, typed API client
  ui/          Preact components used by the side panel and the dashboard
docs/
```

## Deployment

**One Worker, one origin.**

- `/api/*` goes to Hono.
- Everything else is Astro's static build. Static requests are free and don't count toward the Worker request limit.
- Same origin means no CORS for the website and first-party cookies, which Safari needs.
- Environments: `localhost`, then `potli.<account>.workers.dev`, then `usepotli.com` (not bought yet; buy through Cloudflare Registrar).

---

## How it works

### Saving a page

1. The user clicks the toolbar icon. That click gives the extension `activeTab` access to the page.
2. The extension extracts the URL, title, meta description, and an excerpt of about 1,000 words. It uses Readability for most pages and special handling for GitHub, docs sites, and Stack Overflow.
3. It skips blocklisted domains without sending anything.
4. `POST /api/pages` sends the page to the classifier, which returns `{ choice, probabilities, confidence }`.
5. **If confidence is 0.6 or higher:** the page is filed into that category.
6. **Otherwise:** the page goes to Inbox and gets marked for review.
7. A notice appears in the corner of the page (inside a shadow DOM so the page's CSS can't affect it):
   - Filed: "Saved to Tutorials · Change · Open panel"
   - Low confidence: the top 2 categories as chips, plus Inbox
   - Already saved: "Already in X · Move / Remove"
8. The toolbar badge shows ✓ when filed and **?** when the page needs review.

### Side panel (opened when the user wants it)

- **Ways to open it:** right-click the icon → _Open Potli_, the keyboard shortcut, the _Open panel_ link in the notice, or the browser's own side panel menu.
- **What it shows:** whether the current page is saved, recent saves by category, pages waiting for review, move/delete, and a link to the dashboard.

| Browser               | Panel surface                     | Icon click                                                   |
| --------------------- | --------------------------------- | ------------------------------------------------------------ |
| Chrome / Edge / Brave | `sidePanel`                       | saves                                                        |
| Firefox               | `sidebar_action`                  | saves                                                        |
| Safari                | popup (Safari has no sidebar API) | opens the popup, which saves the page and shows a mini panel |

### Learning from corrections

- When the user moves a page or taps a suggestion chip, the page's title is added to that category's `examples`.
- Each category keeps its 10 most recent examples.
- The examples go into the Jev criteria sent with each classification.

---

## Auth

There is one auth system, and it lives on the website. The extension doesn't use `chrome.identity`.

**Website**

1. Google OAuth redirect to `/api/auth/google/callback`.
2. The Worker exchanges the code using the client secret, verifies the ID token, and uses Google's `sub` as the user ID.
3. The session is stored in an HttpOnly, Secure, SameSite=Lax cookie. The server also checks the Origin header on writes.

**Extension (handoff)**

1. The extension creates a PKCE verifier and challenge, then opens `/connect?challenge=…`.
2. The user signs in on the website. This step is instant if they're already signed in.
3. The page issues a one-time code that is valid for 60 seconds.
4. A content script that runs only on `/connect` passes the code to the extension's background script.
5. The background script sends the code and verifier to `POST /api/auth/token` and gets back an access JWT plus a refresh token.
6. API calls use `Authorization: Bearer …`.

**Tokens**

- Access JWT: valid for 15 minutes.
- Refresh token: valid for 60 days and rotated on every use. If an old refresh token is reused, the server revokes that whole session family.

**Google setup**

- One OAuth client of type "Web application".
- Its redirect URIs are just the `/api/auth/google/callback` URL for each environment.

---

## Data model (D1)

```
users          id (google sub), email, name, created_at
sessions       id, user_id, refresh_token_hash, family_id, expires_at, created_at
auth_codes     code_hash, user_id, challenge, expires_at        -- extension handoff
categories     id, user_id, name, description, examples_json, position, created_at
pages          id, user_id, category_id NULL = Inbox, url, title, excerpt,
               confidence, probabilities_json, filed_by (auto|suggested|user),
               needs_review, created_at          UNIQUE(user_id, url)
user_settings  user_id, blocklist_json, threshold (default 0.6)
```

- **IDs:** UUIDv7 stored as text.
- **Timestamps:** integer milliseconds.
- **Inbox** is not a stored row. It means `category_id IS NULL`.
- **Deleting a category** moves its pages to Inbox.

## API (all routes under `/api`)

```
GET    /auth/google              start web sign-in
GET    /auth/google/callback
POST   /auth/connect             website → one-time code for the extension (cookie auth)
POST   /auth/token               extension: code + verifier → tokens
POST   /auth/refresh
POST   /auth/logout              ?all=1 signs out every device

GET    /me     DELETE /me        account + full data deletion
GET    /settings  PATCH /settings
POST   /onboarding               create the categories chosen during onboarding

GET POST PATCH DELETE  /categories[/:id]
POST   /pages                    classify + save (rate limited)
GET    /pages?category=&review=
PATCH  /pages/:id                move (counts as a correction)
DELETE /pages/:id
```

## Onboarding

After the first sign-in, the user picks their starting categories. They can skip and do it later.

- **Developer pack (selected by default):** Docs & References, Tutorials, Tools & Libraries, Articles, Talks & Videos, Read Later
- **General pack:** Recipes, Shopping, Travel, Health, Finance, Read Later
- **Custom:** a name plus a one-line description. Jev uses the description.

## Guardrails

- **Domain blocklist:** a default list (banking, mail) plus the user's own additions. Checked in the extension and again on the server.
- **Rate limit on `POST /pages`:** the Workers Rate Limiting binding, keyed by user ID, plus a daily cap stored in D1.
- **Free-tier CPU limit (10ms):** use only WebCrypto inside the Worker (JWT, SHA-256). Waiting on Jev doesn't count toward CPU time.
- **Secrets** (set with `wrangler secret`, and in `.dev.vars` locally): `JEV_API_KEY`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Extension UI is optimistic:** it updates immediately and rolls back if the request fails.

## Brand

- **Look:** handloom tones (indigo, madder red, turmeric, khadi off-white), block-print patterns, a drawstring motif, a warm serif for headings, and an optional पोटली wordmark.
- **Wording, light touch:** brand voice on the website and in empty states ("Your potli is empty"). UI labels stay plain: Categories, Inbox, Save.

---

## MVP

**In:** auth (website + extension), onboarding, categories CRUD, save + classify, the notice and badge, the side panel, move/delete, the dashboard, settings, account deletion, and the marketing site.

**Later:** PWA for phones, search, a background queue, MCP server and CLI (high priority, since the audience is developers), an embeddings fallback, nested categories, and tags.

## Milestones

| #   | Goal                     | Done when                                                                                             |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| 0   | Scaffold                 | All apps run locally from the repo root                                                               |
| 1   | API + web auth           | Can sign in on localhost with Google and see `/api/me`                                                |
| 2   | Dashboard basics         | Onboarding and categories CRUD work                                                                   |
| 3   | Extension connect + save | Chrome saves pages using a fake classifier                                                            |
| 4   | Jev                      | Real classification and corrections feeding examples                                                  |
| 5   | Side panel + notice      | Full Chrome flow; Firefox works too                                                                   |
| 6   | Safari                   | Popup flow works through an Xcode build                                                               |
| 7   | Marketing site + theme   | Landing page, privacy policy, terms                                                                   |
| 8   | Ship                     | Running on workers.dev, then domain bought, Google OAuth verified, extensions submitted to the stores |

## Open items

- [ ] Google Cloud project + OAuth client (Web application)
- [ ] Jev API docs / sample request & response
- [ ] Check whether _Open panel_ in the notice can open the side panel (browsers may not count a click on the web page). Fallback: show the keyboard shortcut instead.
- [ ] Apple Developer Program ($99/yr), needed before shipping to Safari
- [ ] Buy usepotli.com
