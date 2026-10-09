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

// Buyer reports may not be sold until their exact evidence and delivery
// identity have been durably accepted by the original, governed intake.
// The current production static site has no such endpoint: fail CLOSED.
async function reservePaidDiagnosisBeforeCheckout(config, checkoutRef, email, consent) {
  if (!consent || typeof email !== "string"
      || !/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,40}$/.test(email)
      || typeof checkoutRef !== "string" || !/^[0-9a-f-]{20,80}$/i.test(checkoutRef)
      || config?.fulfillment?.mode !== "AUTOMATIC_AI_ONLY"
      || config?.fulfillment?.status !== "VERIFIED_READY"
      || config?.fulfillment?.intake_path !== "/v1/feedhealth/checkout-intents"
      || !isSandboxPaddleCheckout(config)) {
    throw new Error("TRUSTED_DIAGNOSIS_INTAKE_NOT_READY");
  }
  const getEvidence = globalThis.feedHealthBuyerEvidenceSnapshotV1;
  const evidence = typeof getEvidence === "function" ? getEvidence() : null;
  if (!evidence || evidence.schema !== "feedhealth.buyer_evidence_snapshot.v1"
      || !Array.isArray(evidence.products) || evidence.products.length < 1
      || evidence.products.length > 50) {
    throw new Error("BUYER_EVIDENCE_REQUIRED_BEFORE_PAYMENT");
  }
  const request = JSON.stringify({
    schema: "feedhealth.checkout_intent_request.v1",
    checkout_ref: checkoutRef,
    delivery_email: email.trim().toLowerCase(),
    consent_version: "FEEDHEALTH_BUYER_REPORT_DELIVERY_V1",
    evidence
  });
  if (request.length > 135000) throw new Error("BUYER_EVIDENCE_LIMIT_EXCEEDED");
  // Same-origin only; never forward the buyer's supplied records to Paddle
  // or to a third-party collector from browser context.
  const response = await fetch(config.fulfillment.intake_path, {
    method: "POST", credentials: "same-origin", redirect: "error",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "Accept": "application/json",
               "Idempotency-Key": checkoutRef },
    body: request
  });
  if (response.status !== 201) throw new Error("TRUSTED_DIAGNOSIS_INTAKE_REJECTED");
  const receipt = await response.json();
  if (receipt?.schema !== "feedhealth.checkout_intent_receipt.v1"
      || receipt?.decision !== "ACCEPTED"
      || receipt?.checkout_ref !== checkoutRef
      || receipt?.ai_delivery_authorized_after_verified_payment !== true
      || receipt?.session_mode !== "HTTP_ONLY_COOKIE"
      || Object.hasOwn(receipt,"delivery_token")) {
    throw new Error("TRUSTED_DIAGNOSIS_RECEIPT_MISMATCH");
  }
  return receipt;
}

// Browser callbacks are never evidence of payment. They only wake a read
// against the original server, which requires a signed Paddle-paid SoR receipt.
let authorizedReportSession = null;
let authorizedReportPollRunning = false;
const REPORT_MAX_CHECKS = 36;

async function requestSignedPaidReport(config, session) {
  if (!config?.fulfillment
      || config.fulfillment.status !== "VERIFIED_READY"
      || config.fulfillment.report_path !== "/v1/feedhealth/reports/read"
      || !session || session.schema !== "feedhealth.client_report_session.v1"
      || (session.checkout_ref !== undefined && !/^[0-9a-f-]{36}$/i.test(session.checkout_ref))
      || session.session_mode !== "HTTP_ONLY_COOKIE") {
    throw new Error("BUYER_REPORT_DELIVERY_NOT_AUTHORIZED");
  }
  const response=await fetch(config.fulfillment.report_path,{
    method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify(session.checkout_ref ? {checkout_ref:session.checkout_ref} : {})
  });
  // Payment not yet signed, or AI retry still in progress: do not leak state.
  if (response.status===401 || response.status===403) throw new Error("BUYER_REPORT_SESSION_UNAVAILABLE");
  if ([202,404,409,425,503].includes(response.status)) return null;
  if (response.status!==200) throw new Error("REPORT_DELIVERY_SERVER_REJECTED");
  const receipt=await response.json();
  if (receipt?.schema!=="feedhealth.authorized_report_delivery.v1"
      || (session.checkout_ref && receipt.checkout_ref!==session.checkout_ref)
      || receipt?.delivery_mode!=="AUTHORIZED_BUYER_PULL"
      || receipt?.report?.schema!=="feedhealth.ai_diagnosis_report.v1"
      || receipt.report.checkout_ref!==receipt.checkout_ref
      || !/^[0-9a-f]{64}$/.test(receipt.report_sha256||"")) {
    throw new Error("REPORT_DELIVERY_SOURCE_BINDING_FAILED");
  }
  return receipt;
}

function showAuthorizedReport(receipt) {
  const host=document.getElementById("feedhealth-paid-report");
  if (!host) throw new Error("REPORT_CONTAINER_MISSING");
  // Never inject the model response via innerHTML or trust HTML in product text.
  const summary=document.createElement("p");
  summary.textContent=String(receipt.report.summary||"Report ready.");
  const data=JSON.stringify(receipt.report,null,2);
  if (data.length>120000) throw new Error("REPORT_TOO_LARGE");
  const blob=new Blob([data],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download="FeedHealth-diagnosis-"+receipt.checkout_ref+".json";
  link.textContent="Download your verified-payment AI report";
  link.rel="noopener noreferrer";
  host.replaceChildren(summary,link);
  host.hidden=false;
}

async function pollSignedPaymentAndReport(config) {
  if (authorizedReportPollRunning || !authorizedReportSession) return;
  authorizedReportPollRunning=true;
  const status=document.getElementById("checkout-state");
  try {
    for(let attempt=0;attempt<REPORT_MAX_CHECKS;attempt++) {
      if (!authorizedReportSession) break;
      let receipt=null;
      try {
        receipt=await requestSignedPaidReport(config,authorizedReportSession);
      } catch (error) {
        if (error?.message==="BUYER_REPORT_SESSION_UNAVAILABLE") throw error;
        // Server/network failure is not permission to report a paid sale.
        if (attempt===REPORT_MAX_CHECKS-1) throw new Error("REPORT_DELIVERY_UNAVAILABLE");
      }
      if(receipt) {
        showAuthorizedReport(receipt);
        if(status) status.textContent="Your AI diagnosis has been generated and is ready for secure download.";
        authorizedReportSession=null;
        return;
      }
      if(status) status.textContent="Waiting for server-verified payment and automatic AI diagnosis. Browser checkout events are not proof of payment.";
      await new Promise(resolve=>setTimeout(resolve,10000));
    }
    if(status) status.textContent="Report still processing or delivery unavailable. Keep this page open; no payment status is being asserted.";
  } finally {
    authorizedReportPollRunning=false;
  }
}

let sandboxPaddleInitialized = false;
async function openSandboxPaddleCheckout(config, checkoutRef) {
  if (!isSandboxPaddleCheckout(config)) throw new Error("Sandbox payment not authorized");
  const paddle = await loadSandboxPaddle();
  if (!sandboxPaddleInitialized) {
    paddle.Environment.set("sandbox");
    paddle.Initialize({
      token: config.paddle.client_side_token,
      eventCallback: event => {
        // Notification is only a wakeup. Server verifies raw Paddle HMAC first.
        if (event?.name==="checkout.completed") {
          void pollSignedPaymentAndReport(config).catch(() => {
            const node=document.getElementById("checkout-state");
            if(node) node.textContent="Report verification is temporarily unavailable. No browser payment event was trusted.";
          });
        }
      }
    });
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

    <div class="offer-evidence-consent">
      <label for="diagnosis-delivery-email">Email for your automatically generated digital report</label>
      <input id="diagnosis-delivery-email" type="email" autocomplete="email" maxlength="254"
        placeholder="buyer@example.com" required />
      <label><input id="diagnosis-buyer-consent" type="checkbox" />
        I authorize QIANWU FeedHealth to process the product data I reviewed here solely
        to generate and securely deliver my requested AI diagnostic report after verified payment.</label>
    </div>
    <div class="offer-actions">
      <button id="buy-diagnosis" class="button primary" type="button">Get Verified Diagnosis — ${money(currency, price)}</button>
      <a class="button secondary" href="mailto:feedhealth@qianwuai.com?subject=Feed%20Health%20question">Ask a question</a>
    </div>
    ${checkout?.fulfillment?.status==="VERIFIED_READY" ? '<button id="resume-report" class="button ghost" type="button">Retrieve an existing paid report on this device</button>' : ""}
    <div id="feedhealth-paid-report" role="region" aria-label="Verified paid diagnosis report" hidden></div>
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

  document.getElementById("resume-report")?.addEventListener("click", () => {
    authorizedReportSession={schema:"feedhealth.client_report_session.v1",
      session_mode:"HTTP_ONLY_COOKIE"};
    void pollSignedPaymentAndReport(checkout).catch(() => {
      const status=document.getElementById("checkout-state");
      if(status) status.textContent="No authorized report could be retrieved for this browser session.";
    });
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
      status.textContent = "Checking trusted diagnosis intake before allowing a Sandbox payment…";
      try {
        const email = document.getElementById("diagnosis-delivery-email")?.value || "";
        const consent = document.getElementById("diagnosis-buyer-consent")?.checked === true;
        const reservation=await reservePaidDiagnosisBeforeCheckout(checkout, checkoutRef, email, consent);
        if (reservation.session_mode!=="HTTP_ONLY_COOKIE" || Object.hasOwn(reservation,"delivery_token"))
          throw new Error("BUYER_HTTPONLY_REPORT_SESSION_REQUIRED");
        authorizedReportSession={schema:"feedhealth.client_report_session.v1",
          checkout_ref:checkoutRef,session_mode:"HTTP_ONLY_COOKIE"};
        try {
          await openSandboxPaddleCheckout(checkout, checkoutRef);
        } catch (error) {
          authorizedReportSession=null;
          throw error;
        }
      } catch {
        status.textContent = "Sandbox checkout withheld: buyer evidence, consent or verified delivery intake is unavailable. No payment has been taken.";
        status.className = "intent-message warning";
      }
      return;
    }
    // A future production checkout requires its own separately approved
    // buyer-to-fulfillment reservation; do not permit unbound payment links.
    status.textContent = "Payment is withheld until secure AI report delivery is verified.";
    status.className = "intent-message warning";
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
  // Recovery is explicit buyer action plus HttpOnly cookie, not tracking storage.

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
