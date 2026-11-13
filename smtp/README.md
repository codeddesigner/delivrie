# Delivrie SMTP relay

Accepts mail on `smtp.delivrie.io` (ports 465 and 2465, implicit TLS) and sends it through `POST /emails`,
so limits, logs, webhooks, suppressions and domain checks are the same as the API.

- Username `delivrie`, password a Delivrie API key.
- Fly.io terminates TLS and passes the client IP with the PROXY protocol; the app listens on 2525 in plain text.
- No dependencies. `node smtp/test.mjs` runs an end-to-end test against a fake API.
- Deployed by `.github/workflows/deploy-smtp.yml` (needs the `FLY_API_TOKEN` repository secret).

Run locally without Fly: `PROXY_PROTOCOL=0 PORT=2525 node smtp/server.mjs`, then connect with `swaks` or `openssl s_client`-less plain TCP.
