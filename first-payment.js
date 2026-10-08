"use strict";

const FIRST_PAYMENT_RELEASE = "feed_health_first_payment_candidate_v1";
const FIRST_PAYMENT_FORM = "feed-health-validation";
const FIRST_PAYMENT_EVENTS = new Set([
  "RESULT_PAGE_VIEW",
  "VIEW_EVIDENCE",
  "VIEW_FULL_RESULT",
  "BUY_DIAGNOSIS",
  "START_CHECKOUT",
  "PAYMENT_CANCELLED",
  "PAYMENT_FAILED"
]);

const buyerSessionRef = (() => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
})();

const safeToken = (value, fallback = "") => String(value ?? fallback)
  .replace(/[^a-zA-Z0-9._:-]/g, "")
  .slice(0, 80);

const query = new URLSearchParams(location.search);
const sourceChannel = safeToken(query.get("src"), "WEB_SCANNER") || "WEB_SCANNER";
const cohortRef = safeToken(query.get("cohort"), "SELF_SERVICE") || "SELF_SERVICE";

function eventId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function postBuyerAction(eventName, detail = {}) {
  if (!FIRST_PAYMENT_EVENTS.has(eventName)) return false;
  const payload = {
    "form-name": FIRST_PAYMENT_FORM,
    "bot-field": "",
    event_type: eventName,
    event_id: eventId(),
    subject_key: buyerSessionRef,
    session_ref: buyerSessionRef,
    occurred_at: new Date().toISOString(),
    source_channel: sourceChannel,
    cohort_ref: cohortRef,
    offer_ref: safeToken(detail.offer_ref, "VERIFIED_FEED_DIAGNOSIS"),
    checkout_ref: safeToken(detail.checkout_ref),
    amount: detail.amount == null ? "" : String(detail.amount),
    currency: safeToken(detail.currency, "USD"),
    payment_state: safeToken(detail.payment_state),
    release_version: FIRST_PAYMENT_RELEASE
  };
  // The new static host does not yet have a consent-reviewed event endpoint.
  // Do not claim checkout interest or payment from a failed POST to "/".
  return false;
}

async function loadJson(path) {
  const response = await fetch(path, { credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function money(currency, amount) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${amount}`;
  }
}

function trustedCheckoutUrl(config) {
  if (!config?.enabled || typeof config.checkout_url !== "string") return null;
  try {
    const url = new URL(config.checkout_url);
    if (url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

// Only explicitly configured Sandbox sessions may load Paddle.js.
// Never initialize an unverified live checkout or claim server-side payment.
function isSandboxPaddleCheckout(config) {
  if (!config || config.enabled !== true || config.provider !== "PADDLE"
      || config.environment !== "sandbox" || config.sandbox_test_purchase_only !== true
      || config.browser_may_assert_success !== false
      || config.success_confirmation !== "TRUSTED_SERVER_ONLY" || config.currency !== "USD"
      || config.price !== 49 || config.checkout_url !== null) return false;
  const settings = config.paddle;
  return !!(settings && /^test_[a-zA-Z0-9_]{12,160}$/.test(settings.client_side_token || "")
    && /^pri_[a-z0-9]{20,40}$/.test(settings.price_id || "")
    && /^pro_[a-z0-9]{20,40}$/.test(settings.product_id || ""));
}

let sandboxPaddleLoad;
function loadSandboxPaddle() {
  if (globalThis.Paddle) return Promise.resolve(globalThis.Paddle);
  if (!sandboxPaddleLoad) {
    sandboxPaddleLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
      script.async = true;
      script.onload = () => globalThis.Paddle ? resolve(globalThis.Paddle) : reject(new Error("Paddle.js missing"));
      script.onerror = () => reject(new Error("Paddle.js unavailable"));
      document.head.appendChild(script);
    }).catch(error => { sandboxPaddleLoad = null; throw error; });
  }
  return sandboxPaddleLoad;
}

let sandboxPaddleInitialized = false;
async function openSandboxPaddleCheckout(config, checkoutRef) {
  if (!isSandboxPaddleCheckout(config)) throw new Error("Sandbox payment not authorized");
  const paddle = await loadSandboxPaddle();
  if (!sandboxPaddleInitialized) {
    paddle.Environment.set("sandbox");
    paddle.Initialize({ token: config.paddle.client_side_token });
    sandboxPaddleInitialized = true;
  }
  // Only a sandbox transaction can be opened here. Browser events, including
  // checkout.completed, must NEVER grant report access or record paid revenue.
  paddle.Checkout.open({
    items: [{ priceId: config.paddle.price_id, quantity: 1 }],
    customData: { checkout_ref: checkoutRef, offer_ref: "VERIFIED_FEED_DIAGNOSIS", test_only: "true" },
    settings: { displayMode: "overlay", theme: "light" }
  });
}

function renderOffer(panel, offer, checkout) {
  const price = Number(offer?.default_test_price ?? checkout?.price ?? 49);
  const currency = String(offer?.currency ?? checkout?.currency ?? "USD");
  const included = Array.isArray(offer?.included) ? offer.included : [];
  const sandboxReady = isSandboxPaddleCheckout(checkout);
  const checkoutReady = Boolean(trustedCheckoutUrl(checkout)) || sandboxReady;

  panel.classList.add("first-payment-offer");
  panel.innerHTML = `
    <div class="offer-head">
      <div>
        <p class="eyebrow">STEP 03 · VERIFIED DIAGNOSIS</p>
        <h3 id="cta-title">Turn this public scan into a verified repair decision.</h3>
        <p class="offer-lede">The free scan is a public observation. The planned paid diagnosis uses AI to analyze buyer-provided product data, label evidence strength, and automatically generate a prioritized digital report. Paid delivery is not live yet.</p>
      </div>
      <div class="offer-price" aria-label="Verified Feed Diagnosis price">
        <span>One-time</span>
        <strong>${money(currency, price)}</strong>
        <small>payment before delivery</small>
      </div>
    </div>

    <div class="offer-grid">
      <div>
        <p class="card-kicker">Included</p>
        <ul class="offer-list">${included.slice(0, 6).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div class="evidence-card">
        <p class="card-kicker">Evidence boundary</p>
        <p><strong>Current scan:</strong> public storefront evidence only.</p>
        <p><strong>Paid diagnosis:</strong> AI-generated findings supported by supplied evidence, with source-strength labels; no human review.</p>
        <p><strong>Not claimed:</strong> authenticated Google/Shopify status unless you separately authorize access.</p>
        <button id="evidence-standard" class="button ghost" type="button" aria-expanded="false">Review evidence standard</button>
      </div>
    </div>

    <div id="evidence-standard-detail" class="evidence-standard-detail" hidden>
      <p><strong>PUBLIC_OBSERVATION</strong> — public storefront/product evidence.</p>
      <p><strong>MERCHANT_AUTHORIZED_SHOPIFY</strong> — authorized Shopify evidence when explicitly connected.</p>
      <p><strong>MERCHANT_AUTHORIZED_GOOGLE</strong> — authenticated Google Merchant evidence when explicitly connected.</p>
      <p><strong>BEFORE_AFTER_VERIFIED</strong> — the same rule verified before and after repair.</p>
    </div>

    <div class="offer-actions">
      <button id="buy-diagnosis" class="button primary" type="button">Get Verified Diagnosis — ${money(currency, price)}</button>
      <a class="button secondary" href="mailto:feedhealth@qianwuai.com?subject=Feed%20Health%20question">Ask a question</a>
    </div>
    <p id="checkout-state" class="intent-message" role="status" aria-live="polite">${sandboxReady ? "Paddle Sandbox test only — no real charge, automatic report fulfillment not yet verified." : (checkoutReady ? "Secure checkout is available." : "Candidate build: secure checkout is intentionally fail-closed until a trusted payment provider is bound.")}</p>
    <p class="offer-footnote">No store changes are made by this purchase. No guarantee of approval, ranking, traffic, ROAS, or sales is made.</p>
  `;

  const evidenceButton = document.getElementById("evidence-standard");
  const evidenceDetail = document.getElementById("evidence-standard-detail");
  evidenceButton?.addEventListener("click", () => {
    const nextHidden = !evidenceDetail.hidden;
    evidenceDetail.hidden = nextHidden;
    evidenceButton.setAttribute("aria-expanded", String(!nextHidden));
    if (!nextHidden) postBuyerAction("VIEW_EVIDENCE");
  });

  document.getElementById("buy-diagnosis")?.addEventListener("click", async () => {
    const status = document.getElementById("checkout-state");
    await postBuyerAction("BUY_DIAGNOSIS", {
      amount: price,
      currency,
      offer_ref: offer?.sku || "VERIFIED_FEED_DIAGNOSIS"
    });

    const sandboxReady = isSandboxPaddleCheckout(checkout);
    const checkoutUrl = trustedCheckoutUrl(checkout);
    if (!sandboxReady && !checkoutUrl) {
      status.textContent = "Secure checkout is not active on this candidate build. No payment has been taken.";
      status.className = "intent-message warning";
      return;
    }

    const checkoutRef = eventId();
    await postBuyerAction("START_CHECKOUT", {
      amount: price,
      currency,
      offer_ref: offer?.sku || "VERIFIED_FEED_DIAGNOSIS",
      checkout_ref: checkoutRef
    });
    if (sandboxReady) {
      status.textContent = "Opening Paddle Sandbox — test payment only; report delivery is not yet connected.";
      try {
        await openSandboxPaddleCheckout(checkout, checkoutRef);
      } catch {
        status.textContent = "Sandbox checkout unavailable. No payment has been taken.";
        status.className = "intent-message warning";
      }
      return;
    }
    checkoutUrl.searchParams.set("client_reference_id", checkoutRef);
    location.assign(checkoutUrl.toString());
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function initializeFirstPayment() {
  const panel = document.querySelector(".cta-panel");
  if (!panel) return;

  let offer;
  let checkout;
  try {
    [offer, checkout] = await Promise.all([
      loadJson("first-payment-offer.v1.json"),
      loadJson("checkout-config.v1.json")
    ]);
  } catch {
    panel.querySelector("#intent-message")?.replaceChildren("Commercial offer configuration could not be loaded. The free scan remains available.");
    return;
  }

  renderOffer(panel, offer, checkout);

  const results = document.getElementById("results");
  let resultSeen = false;
  const observeResults = () => {
    if (!resultSeen && results && !results.hidden) {
      resultSeen = true;
      postBuyerAction("RESULT_PAGE_VIEW");
    }
  };
  observeResults();
  if (results) new MutationObserver(observeResults).observe(results, { attributes: true, attributeFilter: ["hidden"] });

  document.getElementById("copy-report")?.addEventListener("click", () => postBuyerAction("VIEW_FULL_RESULT"), { capture: true });
}

document.addEventListener("DOMContentLoaded", initializeFirstPayment, { once: true });
