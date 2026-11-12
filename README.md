# Delivrie

Email for developers: transactional and marketing email with a REST API, signed webhooks, a visual broadcast editor, audiences, metrics, and an MCP server for AI agents. Sending runs on Amazon SES.

Live at https://delivrie.io

## Structure

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `script.js` | Marketing landing page |
| `app.html`, `app/` | Dashboard SPA (vanilla JS ES modules, no build step) |
| `assets/` | Logos, favicon and icons (from the Figma brand page) |
| `supabase/functions/delivrie/` | Edge function: REST API, SES/SNS integration, webhooks, cron, MCP server |
| `supabase/functions/billing/` | Edge function: Paystack subscriptions (USD and NGN), served at `/api/billing/*` |
| `supabase/migrations/` | Database schema: tables, row-level security, RPCs, cron job, storage bucket |
| `vercel.json` | Rewrites `/api/*` to the edge function and app routes to `app.html` |

## Deploy

- **Frontend:** static files on Vercel. No build command; output directory is the repo root.
- **Backend functions:** pushed changes under `supabase/functions/` deploy automatically through `.github/workflows/deploy-functions.yml` (needs the `SUPABASE_ACCESS_TOKEN` repository secret).
- **Backend:** Supabase (Postgres + Auth + Storage) with the `delivrie` edge function.
  To recreate the database on a new project, run the files in `supabase/migrations/` in order (or `supabase db push`). The cron migration contains the project's function URL; change it if you deploy to a different project.

## Configuration (Supabase edge function secrets)

| Secret | Required | Purpose |
|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Yes | IAM user with `ses:*` and SNS access to `delivrie-events` topics |
| `APP_URL` | Yes | Public URL, e.g. `https://delivrie.io` |
| `SYSTEM_FROM` | Optional | Sender for invites/system mail, e.g. `Delivrie <notifications@delivrie.io>` |
| `SYSTEM_REGION` | Optional | Default SES region (default `eu-west-1`) |
| `ANTHROPIC_API_KEY` | Optional | Enables AI answers in Help → Ask Delivrie |
| `ENFORCE_LIMITS` | Optional | `true` to enforce plan limits |
| `PAYSTACK_SECRET_KEY` | For billing | Paystack secret key (`sk_test_…` while testing, `sk_live_…` in production) |

The Supabase anon key in `app/js/lib/sb.js` is public by design; data access is protected by row-level security.
