# FeedHealth Paddle Sandbox P0-C handoff (2026-10-08)

Candidate source PR only. Existing production checkout remains provider=UNBOUND and enabled=false. NO live payment deployment, no buyer report delivery, no API keys, no merchant webhook secrets, and no buyer PII included.

## Founder's actual Paddle Sandbox dashboard setup
- Active Product: Verified Feed Diagnosis
- Active Price: USD $49, one-time purchase (verify billing model on price details)
- Tax category: SaaS
- Client-side token named FeedHealth Sandbox Web: ACTIVE
- Default payment link: https://feed.qianwuai.com/ (Sandbox settings: saved)

Exact full pro_ and pri_ IDs and public test_ client token must come from the original Paddle Sandbox dashboard, not guessed or hardcoded. Server API keys and webhook secrets are never valid frontend credentials.

## Safe isolated Sandbox candidate configuration
Use the three environment variables FEEDHEALTH_PADDLE_SANDBOX_CLIENT_TOKEN,
FEEDHEALTH_PADDLE_SANDBOX_PRODUCT_ID and FEEDHEALTH_PADDLE_SANDBOX_PRICE_ID
in the existing authorized staging pipeline. They are not configured here.
Run only in a separate staging build artifact:

    python3 scripts/create-paddle-sandbox-config-v1.py --output /tmp/feedhealth-sandbox-build/checkout-config.v1.json

The generated config must replace checkout-config.v1.json ONLY in an authorized isolated STAGING build, never in production Git, Rails or Railway live environment. This generator deliberately refuses tracked output paths and validates test_ / pro_ / pri_ formats. It prints no token values.

The webpage then loads Paddle.js from Paddle's CDN only when strictly valid Sandbox config exists; sets Paddle.Environment.set("sandbox"); initializes with the public client-side token and opens the original one-price test item, quantity 1, and no PII in custom metadata. Browser callbacks never assert payment success or fulfill a report. Production remains fail-closed by default.

## Remaining hard holds
1. No Paddle credential has been installed in any approved staging pipeline; no tested browser transaction or verified Paddle webhook receipt exists.
2. Group original PR #427 is OPEN/UNMERGED and has not been independently approved / deployed. It owns trusted Paddle server-side ingress to the single original Shared Gateway and Group SoR. Browser checkout complete is not proof of payment.
3. Existing public feed scanner is a deterministic client-side free scanner that lets visitors COPY text. It is NOT an authenticated full paid AI diagnosis service. Need existing Shared AI Gateway, server-side idempotent paid analysis job, source-strength constraints, and an authorization-controlled download or email delivery endpoint. Reuse original Group OS instead of adding a second CRM, gateway, or payment ledger.
4. Bind a single checkout_ref to a consented buyer report submission before the payment, and do not expose buyer payload in URLs, event metadata or Paddle customData. Refund, timeout, retry and duplicate webhook cases must fail safe.
5. End-to-end Sandbox transaction.completed signature verification, exact price/product validation, report generation, secure delivery, original Group SoR readback, independent GAEC source/production approval and natural buyer UAT remain unproven.

Useful provider documentation:
https://developer.paddle.com/paddle-js/about/include-paddlejs/
https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/
https://developer.paddle.com/webhooks/about/signature-verification/
