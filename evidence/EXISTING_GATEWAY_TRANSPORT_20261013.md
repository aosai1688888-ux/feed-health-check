# FeedHealth existing-site transport candidate — 2026-10-13

Status: SOURCE_CANDIDATE / NOT DEPLOYED / NO RELEASE APPROVAL.
Seller: 深圳市乾五数字科技有限公司 (LE-QWDIGITAL).

## Scope and actual route
Keep the existing Railway service, original Action Gateway and original Group SoR.
The existing site's Nginx forwards exactly these POST paths over certificate-verified HTTPS:
- /webhooks/paddle
- /v1/feedhealth/checkout-intents
- /v1/feedhealth/reports/read
- /v1/feedhealth/reports/ack

The upstream must be an independently admitted hostname under qianwuai.com on
the EXISTING cloudflared tunnel, with Cloudflare Access Service Auth limited to
the website's dedicated service token. Do not provision another tunnel, server,
gateway, database or generic API. Public Group port 4100 remains closed.

Traffic: buyer/Paddle -> existing Railway website -> approved Access-protected
HTTPS tunnel hostname -> existing private 172.20.128.171:4100 exact public paths.
Tunnel ingress must allow only the four exact paths, followed by HTTP 404 for
that hostname; preserve all unrelated existing tunnel routes. At the tunnel,
validate the Access application audience (originRequest.access.required=true
with the correct teamName/audTag) so a missing/misconfigured edge Access policy
cannot silently expose the private Gateway. Never forward /v1/read, /v1/commands,
/v1/assurance/*, the internal payment relay or the AI worker paths.

## Required independently admitted configuration
Railway server-side variables (never browser assets):
- FEEDHEALTH_TRANSPORT_ENABLED=1
- FEEDHEALTH_TRANSPORT_ADMISSION=GAEC_GO
- FEEDHEALTH_GATEWAY_INGRESS_HOST=<exact approved hostname; not feed.qianwuai.com>
- FEEDHEALTH_ACCESS_CLIENT_ID=<dedicated Access Service Auth client ID>
- FEEDHEALTH_ACCESS_CLIENT_SECRET=<dedicated Access Service Auth client secret>

These variable values do NOT constitute independent approval. Retain the
original GAEC exact source verdict, permitted scope, tunnel/Access specification,
runtime release CAPA and rollback evidence before setting them. No actual
hostname, Access application/token or production change was created by this patch.
Do not use the original Group master token, Paddle API key, Paddle signing secret
or buyer report entitlement as the transport credential.

On the original Gateway, separately admit the two public mode flags and install
the real Paddle Sandbox destination secret, D2 encryption key and exact Sandbox
Product/Price/environment profile through the original secret store. Apply 0176,
0177 and 0178 with original approved migration sequencing and legal-entity
preconditions. The upstream remains the sole signature verifier/payment writer.
Cloudflare supplies CF-Connecting-IP; the proxy discards client-supplied source
claims. Gateway's existing aggregate/per-source rate limit is conservative because
Cloudflare sees Railway egress IP, not an authenticated individual customer IP.
Do not relax it to improve throughput; independently admit edge/WAF limits.

## Boundary controls
- Disabled by default; static pages remain available and four API routes return 503.
- Exact path and POST only; no query strings, alternate encoded URI or broad /v1 proxy.
- HTTPS SNI + certificate verification required; no HTTP or insecure TLS fallback.
- Raw request body preserved, Paddle-Signature only forwarded on webhook.
- Cookie forwarded only for report read/ack; only checkout intake may set a cookie.
- No client Authorization, forwarding headers, Access credential overrides or IP claims.
- Request/response size/time bounds, no retry, no cache/store, sensitive route logs off.
- Group Gateway still verifies consent, secure entitlement, provider HMAC, SKU,
  amount, environment, idempotency and original SoR state before financial effects.

## Reproducible source/container verification
Build the original Dockerfile, then run:
    python3 scripts/test-feedhealth-transport-v1.py

This creates disposable isolated Docker network/HTTPS fixtures, cleans them in
finally, and proves raw byte/signature transport, header isolation, HTTPS trust,
cookie scope, origin/method/size denial, private path denial and disabled mode.
The fixture is not Paddle, not production Group SoR, and not a real customer.
No payment, provider inference, production receipt or actual report delivery
is claimed. Existing Railway static-host CI runs this test against the exact head.

## Required actual acceptance after independent release admission
1. Negative probe all private paths and unsigned webhook, verify no SoR writes.
2. Establish genuine Sandbox notification destination; securely install its secret.
3. Reserved buyer evidence + consent -> official Sandbox checkout/test card ->
   real signed transaction.completed -> original append-only SoR Sandbox receipt.
4. Duplicate/tampered/environment/SKU negatives and restart/retry reconciliation.
5. Authorized, budget-bounded original AI Gateway inference; validate evidence
   references/report quality; retain model request/usage/SoR completion proof.
6. Buyer cookie report retrieval -> actual download -> original digest-bound ack.
7. Independent GAEC readback. Sandbox evidence cannot be counted as real revenue.
8. Paddle Live merchant approval + separate Live release admission + full
   readiness evidence, then external customer US$49 commercial acceptance.

Rollback: set the existing transport mode to 0 and deploy the independently
approved prior website image. Retain original Group SoR records; never rewrite
payment or delivery history. Do not enable Live checkout as part of transport setup.
