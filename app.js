"use strict";

const MAX_PRODUCTS = 50;
const VALIDATION_FORM_NAME = "feed-health-validation";
const RELEASE_VERSION = "feed_health_v1_customer_ready";
const VALIDATION_EVENT_TYPES = new Set([
  "PAGE_VIEW",
  "CHECK_STARTED",
  "CHECK_COMPLETED",
  "CHECK_FAILED",
  "FIX_INTEREST",
  "PRICE_INTENT"
]);
const sessionEvents = [];
const subjectKey = (() => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
})();

const $ = id => document.getElementById(id);
const storeForm = $("store-form");
const storeUrl = $("store-url");
const targetChannel = $("target-channel");
const scanButton = $("scan-button");
const formMessage = $("form-message");
const manualPanel = $("manual-panel");
const manualJson = $("manual-json");
const manualButton = $("manual-button");
const manualMessage = $("manual-message");
const results = $("results");
const findingsNode = $("findings");
const priorityActionsNode = $("priority-actions");
const repairSummaryNode = $("repair-summary");
const intentMessage = $("intent-message");
let latestReport = null;

const CHANNEL_LABELS = {
  google: "Google Merchant / Shopping",
  meta: "Meta catalog",
  general: "General feed readiness"
};

function cleanTelemetryValue(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text.slice(0, 80);
}

function telemetryPayload(event) {
  const detail = event.detail || {};
  return {
    "form-name": VALIDATION_FORM_NAME,
    "bot-field": "",
    event_type: event.event_type,
    subject_key: event.subject_key,
    occurred_at: event.occurred_at,
    mode: cleanTelemetryValue(detail.mode),
    channel: cleanTelemetryValue(detail.channel),
    score_band: cleanTelemetryValue(detail.score_band),
    product_count_band: cleanTelemetryValue(detail.product_count_band),
    p1_count: cleanTelemetryValue(detail.p1_count),
    failure_code: cleanTelemetryValue(detail.failure_code),
    concept: cleanTelemetryValue(detail.concept),
    charge_today: cleanTelemetryValue(detail.charge_today),
    release_version: RELEASE_VERSION
  };
}

async function submitValidationEvent(event) {
  if (!VALIDATION_EVENT_TYPES.has(event.event_type)) return false;
  try {
    const response = await fetch("/", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      keepalive: true,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(telemetryPayload(event)).toString()
    });
    return response.ok;
  } catch {
    return false;
  }
}

function recordEvent(eventType, detail = {}) {
  const event = {
    event_type: eventType,
    subject_key: subjectKey,
    occurred_at: new Date().toISOString(),
    detail
  };
  sessionEvents.push(event);
  return submitValidationEvent(event);
}

function setMessage(node, text, kind = "") {
  node.textContent = text;
  node.className = `form-message ${kind}`.trim();
}

function safeStoreOrigin(raw) {
  const input = String(raw || "").trim();
  if (!input) throw new Error("Enter a storefront URL first.");
  const value = /^https:\/\//i.test(input) ? input : `https://${input}`;
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid storefront URL."); }
  if (url.protocol !== "https:") throw new Error("For this check, the storefront must use HTTPS.");
  if (!url.hostname || url.username || url.password) throw new Error("Use a public storefront URL without embedded credentials.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("Use a public storefront hostname.");
  return url.origin;
}

function stripHtml(value) {
  const el = document.createElement("div");
  el.innerHTML = String(value || "");
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function labelFor(product, index) {
  const title = String(product?.title || "").trim();
  return title || `Product ${index + 1}`;
}

function normalizeProducts(payload) {
  const products = Array.isArray(payload) ? payload : payload?.products;
  if (!Array.isArray(products)) throw new Error('Expected a product array or an object shaped like {"products":[...]} .');
  if (!products.length) throw new Error("No products were found in the supplied public data.");
  return products.slice(0, MAX_PRODUCTS);
}

function allVariantsPass(product, predicate) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.length > 0 && variants.every(predicate);
}

function findingDefinitions() {
  return [
    {
      key: "title", severity: "critical", priority: "P1",
      title: "Missing or unusably short product title",
      why: "The title is a primary product identifier and one of the strongest pieces of catalog context available to downstream commerce systems.",
      channelImpact: {
        google: "Google requires a product title and recommends accurate, specific titles that distinguish the product or variant.",
        meta: "A clear title improves catalog legibility and helps shoppers understand which item or variant they are viewing.",
        general: "Weak titles make products harder to identify, classify, search, and reconcile across channels."
      },
      repairSteps: [
        "Write a truthful product title that clearly identifies the item.",
        "Include differentiating attributes such as product type, brand, color, size, or material when they are genuinely useful.",
        "Remove promotional phrases, excessive capitalization, and vague labels such as “New Item” or “Product 1”."
      ],
      badExample: "New Product - BEST PRICE!!!",
      goodExample: "Acme Merino Wool Crewneck Sweater - Navy - Medium"
    },
    {
      key: "image", severity: "critical", priority: "P1",
      title: "Missing product image",
      why: "A product without a usable image is difficult to merchandise and can be ineligible or ineffective on visual commerce surfaces.",
      channelImpact: {
        google: "Google requires an image link for product listings. Missing primary imagery is a major feed-readiness gap.",
        meta: "Catalog experiences depend heavily on product imagery for browsing and ad creative.",
        general: "Missing imagery damages product comprehension and weakens downstream catalog usability."
      },
      repairSteps: [
        "Add at least one clear primary product image that represents the exact item being sold.",
        "Prefer a high-resolution image with the product clearly visible and without unnecessary promotional overlays.",
        "Re-run this check after publishing the image to confirm the public product record exposes it."
      ],
      badExample: "No image or a placeholder graphic",
      goodExample: "A clear, high-resolution main product photo showing the exact sellable item"
    },
    {
      key: "price", severity: "critical", priority: "P1",
      title: "Missing or non-positive variant price",
      why: "A sellable variant needs a valid positive price for basic commerce readiness and downstream price reconciliation.",
      channelImpact: {
        google: "Google requires price data for product listings and expects submitted pricing to represent the offer accurately.",
        meta: "Catalog and ad experiences depend on valid offer pricing for the item or variant.",
        general: "Missing or invalid price data prevents reliable merchandising and feed reconciliation."
      },
      repairSteps: [
        "Set a valid positive price for every sellable variant.",
        "Confirm the price shown publicly matches the intended offer for that variant.",
        "After editing, re-run the scan and separately verify any authenticated channel feed before launch."
      ],
      badExample: "0.00, blank, or a malformed price",
      goodExample: "29.00 for the exact sellable variant"
    },
    {
      key: "sku", severity: "warning", priority: "P1",
      title: "Variant SKU missing",
      why: "Stable SKUs make products and variants easier to reconcile across operations, feeds, support cases, and future automation.",
      channelImpact: {
        google: "SKU is useful as an internal stable identifier, although Google feed identity rules may use other submitted identifiers depending on integration.",
        meta: "Stable variant identifiers reduce ambiguity when catalogs, ads, and operational systems reference the same item.",
        general: "Missing SKUs make exception handling, reporting, and catalog maintenance harder."
      },
      repairSteps: [
        "Assign a unique, stable SKU to each sellable variant.",
        "Use a consistent format your team can understand and maintain.",
        "Do not recycle an SKU for a different product once it is used operationally."
      ],
      badExample: "Blank SKU or the same SKU reused across unrelated variants",
      goodExample: "SHIRT-BLK-M-001"
    },
    {
      key: "description", severity: "warning", priority: "P2",
      title: "Thin or missing product description",
      why: "Thin descriptions reduce the structured product context available to shoppers and downstream matching systems.",
      channelImpact: {
        google: "Google requires a description and recommends relevant details such as material, size, special features, and visual attributes; this check only flags descriptions under 80 text characters.",
        meta: "Useful descriptions give catalog and ad experiences clearer product context.",
        general: "Richer factual descriptions improve product understanding and reduce ambiguous records."
      },
      repairSteps: [
        "Describe the product itself rather than shipping, promotions, or store policies.",
        "Add factual attributes such as material, dimensions, fit, use case, compatibility, color, pattern, or key features where relevant.",
        "Keep the wording accurate and readable; do not keyword-stuff or invent attributes."
      ],
      badExample: "Great product. Buy now.",
      goodExample: "100% merino wool crewneck sweater with ribbed cuffs, regular fit, and machine-washable construction."
    },
    {
      key: "vendor", severity: "warning", priority: "P2",
      title: "Vendor / brand field missing",
      why: "Consistent manufacturer or brand identity makes product records easier to map, filter, and match across commerce systems.",
      channelImpact: {
        google: "Brand is required for many new products with a clearly associated manufacturer or brand. Verify that Shopify vendor data maps to the truthful manufacturer brand in your feed workflow.",
        meta: "Consistent brand data improves catalog organization and product identity.",
        general: "A missing vendor or brand creates avoidable ambiguity in catalog operations."
      },
      repairSteps: [
        "Populate the truthful manufacturer or brand identity where one exists.",
        "Use one consistent spelling and capitalization across related products.",
        "Do not use the store name as the manufacturer brand unless the store actually manufactures or owns that brand."
      ],
      badExample: "Blank vendor or inconsistent entries such as ACME / Acme Co / acme",
      goodExample: "Acme"
    },
    {
      key: "productType", severity: "warning", priority: "P2",
      title: "Product type missing",
      why: "A consistent product type gives your team a usable internal taxonomy for segmentation, mapping, and feed operations.",
      channelImpact: {
        google: "Shopify product type is not a substitute for every Google taxonomy requirement, but a clean internal type can make downstream category mapping more reliable.",
        meta: "Consistent product types simplify catalog grouping and operational rules.",
        general: "Missing taxonomy makes large catalogs harder to segment, audit, and maintain."
      },
      repairSteps: [
        "Assign a concise, stable product type that describes the actual product class.",
        "Use a controlled vocabulary across similar products instead of creating near-duplicate labels.",
        "Map internal types to channel-specific categories separately when the destination requires them."
      ],
      badExample: "Shirt / Shirts / Tops-Shirt / Misc used interchangeably",
      goodExample: "Shirts"
    },
    {
      key: "duplicates", severity: "warning", priority: "P2",
      title: "Duplicate normalized product titles",
      why: "Identical titles make separate products harder to distinguish and can hide catalog duplication or missing variant detail.",
      channelImpact: {
        google: "Distinct, accurate titles help differentiate products or variants and improve feed clarity.",
        meta: "Duplicate titles can make catalog browsing and ad review harder for merchants and shoppers.",
        general: "Duplicate labels increase reconciliation errors and make catalog QA harder."
      },
      repairSteps: [
        "Confirm whether the records are true duplicates, separate products, or variants that need clearer differentiation.",
        "If they are separate products, add truthful differentiating attributes to each title.",
        "If they should be variants, review the Shopify product structure rather than creating artificial title differences."
      ],
      badExample: "Classic T-Shirt repeated across unrelated records",
      goodExample: "Classic T-Shirt - Organic Cotton - Black"
    },
    {
      key: "alt", severity: "warning", priority: "P3",
      title: "Image alt text missing",
      why: "Descriptive alternative text improves accessibility and gives teams cleaner image metadata.",
      channelImpact: {
        google: "Alt text is not scored here as a Google feed approval requirement; treat this as an accessibility and content-quality improvement.",
        meta: "Treat alt coverage primarily as storefront accessibility and content hygiene rather than a catalog approval guarantee.",
        general: "Alt coverage improves accessibility and makes image assets easier to understand outside purely visual contexts."
      },
      repairSteps: [
        "Write concise alt text that describes the visible product and meaningful distinguishing attributes.",
        "Do not stuff keywords or repeat promotional copy.",
        "Use empty alt only when an image is genuinely decorative rather than a product image."
      ],
      badExample: "image123 or BUY CHEAP SHOES SALE",
      goodExample: "Black leather ankle boot with side zipper"
    },
    {
      key: "barcode", severity: "opportunity", priority: "P3",
      title: "Barcode / GTIN coverage opportunity",
      why: "Manufacturer-assigned GTINs can strengthen product identity matching when they legitimately exist.",
      channelImpact: {
        google: "Google requires GTIN for products that have a manufacturer-assigned GTIN. Valid values must use legitimate identifiers; do not invent them.",
        meta: "Valid manufacturer identifiers can improve cross-system product identity when your catalog workflow supports them.",
        general: "Legitimate global identifiers help distinguish standardized products, but custom or handmade goods may not have one."
      },
      repairSteps: [
        "Check the manufacturer packaging or source data for an assigned UPC, EAN, JAN, ISBN, or other valid GTIN.",
        "Enter only the legitimate manufacturer-assigned identifier for the exact product or variant.",
        "If no GTIN exists, do not fabricate one; handle identifier requirements according to the destination channel."
      ],
      badExample: "A made-up barcode entered only to remove a warning",
      goodExample: "The exact valid UPC/EAN supplied by the manufacturer"
    }
  ];
}

function auditProducts(products, source, channel) {
  const weights = {
    title: 15,
    description: 15,
    image: 15,
    alt: 10,
    vendor: 10,
    productType: 10,
    sku: 15,
    price: 10
  };

  const failures = {
    title: [], description: [], image: [], alt: [], vendor: [], productType: [], sku: [], price: [], barcode: []
  };
  const normalizedTitleMap = new Map();
  let earned = 0;

  products.forEach((product, index) => {
    const label = labelFor(product, index);
    const title = String(product?.title || "").trim();
    const description = stripHtml(product?.body_html || product?.description || "");
    const images = Array.isArray(product?.images) ? product.images : [];
    const titleKey = title.toLocaleLowerCase().replace(/\s+/g, " ").trim();

    const checks = {
      title: title.length >= 3,
      description: description.length >= 80,
      image: images.length > 0,
      alt: images.length > 0 && images.every(img => String(img?.alt || "").trim().length > 0),
      vendor: String(product?.vendor || "").trim().length > 0,
      productType: String(product?.product_type || product?.productType || "").trim().length > 0,
      sku: allVariantsPass(product, variant => String(variant?.sku || "").trim().length > 0),
      price: allVariantsPass(product, variant => Number.parseFloat(variant?.price) > 0)
    };

    Object.entries(checks).forEach(([key, pass]) => {
      if (pass) earned += weights[key];
      else failures[key].push(label);
    });

    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const hasBarcode = variants.length > 0 && variants.every(v => String(v?.barcode || "").trim().length > 0);
    if (!hasBarcode) failures.barcode.push(label);

    if (titleKey) {
      if (!normalizedTitleMap.has(titleKey)) normalizedTitleMap.set(titleKey, []);
      normalizedTitleMap.get(titleKey).push(label);
    }
  });

  const duplicateTitles = Array.from(normalizedTitleMap.values()).filter(group => group.length > 1).flat();
  const possible = products.length * 100;
  const score = Math.max(0, Math.min(100, Math.round((earned / possible) * 100)));
  const buckets = { ...failures, duplicates: duplicateTitles };
  const priorityRank = { P1: 1, P2: 2, P3: 3 };

  const findings = findingDefinitions()
    .map(definition => ({
      ...definition,
      channelImpactText: definition.channelImpact[channel] || definition.channelImpact.general,
      items: buckets[definition.key] || []
    }))
    .filter(item => item.items.length > 0)
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || b.items.length - a.items.length);

  return {
    score,
    product_count: products.length,
    source,
    channel,
    channel_label: CHANNEL_LABELS[channel] || CHANNEL_LABELS.general,
    scanned_at: new Date().toISOString(),
    findings,
    counts: {
      critical: findings.filter(x => x.severity === "critical").length,
      warning: findings.filter(x => x.severity === "warning").length,
      opportunity: findings.filter(x => x.severity === "opportunity").length
    }
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function prioritySummary(report) {
  const p1 = report.findings.filter(item => item.priority === "P1");
  if (p1.length) return `Start with ${p1.length} P1 issue${p1.length === 1 ? "" : "s"}. These are the strongest identity, image, price, or SKU gaps in this scan.`;
  const p2 = report.findings.filter(item => item.priority === "P2");
  if (p2.length) return `No P1 issue was found. Work through ${p2.length} P2 content or taxonomy issue${p2.length === 1 ? "" : "s"} next.`;
  if (report.findings.length) return "The scored checks are in good shape. Review the remaining P3 quality opportunities and re-check after any edits.";
  return "No issue was found in the current checks. Keep monitoring catalog changes and validate authenticated channel diagnostics separately.";
}

function renderPriorityActions(report) {
  repairSummaryNode.textContent = prioritySummary(report);
  const actions = report.findings.slice(0, 3);
  if (!actions.length) {
    priorityActionsNode.innerHTML = '<div class="priority-empty"><strong>No repair queue generated.</strong><span>The supplied records passed the current checks.</span></div>';
    return;
  }
  priorityActionsNode.innerHTML = actions.map((item, index) => `
    <article class="priority-card ${item.priority.toLowerCase()}">
      <div class="priority-number">${index + 1}</div>
      <div>
        <div class="priority-meta"><span class="priority-pill ${item.priority.toLowerCase()}">${item.priority}</span><span>${item.items.length} affected</span></div>
        <h4>${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.repairSteps[0])}</p>
      </div>
    </article>`).join("");
}

function renderReport(report) {
  latestReport = report;
  $("score-value").textContent = report.score;
  $("critical-count").textContent = report.counts.critical;
  $("warning-count").textContent = report.counts.warning;
  $("opportunity-count").textContent = report.counts.opportunity;
  $("report-scope").textContent = `${report.product_count} product${report.product_count === 1 ? "" : "s"} checked · ${report.channel_label} · ${report.source}`;
  renderPriorityActions(report);

  if (!report.findings.length) {
    findingsNode.innerHTML = '<div class="finding"><div class="finding-head"><h4>No issues found in the current checks</h4><span class="badge opportunity">clear</span></div><p>This only means the supplied records passed the eight scored checks plus the current consistency checks. It is not a guarantee of channel approval or performance.</p></div>';
  } else {
    findingsNode.innerHTML = report.findings.map(item => {
      const samples = item.items.slice(0, 5).map(x => `<li>${escapeHtml(x)}</li>`).join("");
      const more = item.items.length > 5 ? `<li>+ ${item.items.length - 5} more affected records</li>` : "";
      const steps = item.repairSteps.map(step => `<li>${escapeHtml(step)}</li>`).join("");
      return `<article class="finding actionable-finding">
        <div class="finding-head">
          <div><div class="finding-priority"><span class="priority-pill ${item.priority.toLowerCase()}">${item.priority}</span><span>${item.items.length} affected</span></div><h4>${escapeHtml(item.title)}</h4></div>
          <span class="badge ${item.severity}">${item.severity}</span>
        </div>
        <div class="finding-grid">
          <div class="finding-block"><span class="block-label">Why it matters</span><p>${escapeHtml(item.why)}</p></div>
          <div class="finding-block"><span class="block-label">${escapeHtml(report.channel_label)} impact</span><p>${escapeHtml(item.channelImpactText)}</p></div>
        </div>
        <div class="repair-box">
          <span class="block-label">Recommended repair</span>
          <ol>${steps}</ol>
          <div class="example-grid">
            <div><span>AVOID</span><p>${escapeHtml(item.badExample)}</p></div>
            <div><span>BETTER</span><p>${escapeHtml(item.goodExample)}</p></div>
          </div>
        </div>
        <details class="affected-list">
          <summary>Show affected product examples</summary>
          <ul class="sample-list">${samples}${more}</ul>
        </details>
      </article>`;
    }).join("");
  }

  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
  void recordEvent("CHECK_COMPLETED", {
    mode: report.source.startsWith("public") ? "public_storefront" : "manual_local_json",
    channel: report.channel,
    score_band: scoreBand(report.score),
    product_count_band: productBand(report.product_count),
    p1_count: report.findings.filter(item => item.priority === "P1").length
  });
}

function scoreBand(score) {
  if (score >= 85) return "85-100";
  if (score >= 70) return "70-84";
  if (score >= 50) return "50-69";
  return "0-49";
}

function productBand(count) {
  if (count <= 10) return "1-10";
  if (count <= 25) return "11-25";
  return "26-50";
}

async function runStorefrontCheck(rawUrl) {
  const origin = safeStoreOrigin(rawUrl);
  const endpoint = `${origin}/products.json?limit=${MAX_PRODUCTS}`;
  void recordEvent("CHECK_STARTED", { mode: "public_storefront", channel: targetChannel.value });
  scanButton.disabled = true;
  setMessage(formMessage, "Reading the public product endpoint once…");

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(`The public endpoint returned HTTP ${response.status}.`);
    const payload = await response.json();
    const products = normalizeProducts(payload);
    renderReport(auditProducts(products, "public storefront data", targetChannel.value));
    setMessage(formMessage, `Check complete. ${products.length} public products analyzed and prioritized.`, "success");
  } catch (error) {
    // Legacy governance marker: CHECK_ACCESS_BLOCKED is represented by CHECK_FAILED telemetry.
    void recordEvent("CHECK_FAILED", {
      mode: "public_storefront",
      channel: targetChannel.value,
      failure_code: "PUBLIC_ENDPOINT_UNAVAILABLE"
    });
    setMessage(formMessage, `We couldn’t access this storefront’s public product endpoint from your browser. This is an access limitation, not a finding about your feed. ${error.message} No retry or proxy was used. If you already have public or non-sensitive sample product JSON, use the local mode below.`, "error");
    manualPanel.open = true;
    manualPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  } finally {
    scanButton.disabled = false;
  }
}

storeForm.addEventListener("submit", event => {
  event.preventDefault();
  try {
    const origin = safeStoreOrigin(storeUrl.value);
    storeUrl.value = origin;
    void runStorefrontCheck(origin);
  } catch (error) {
    setMessage(formMessage, error.message, "error");
  }
});

manualButton.addEventListener("click", () => {
  setMessage(manualMessage, "");
  try {
    const parsed = JSON.parse(manualJson.value);
    const products = normalizeProducts(parsed);
    void recordEvent("CHECK_STARTED", { mode: "manual_local_json", channel: targetChannel.value });
    renderReport(auditProducts(products, "local pasted public/sample JSON", targetChannel.value));
    setMessage(manualMessage, `Local check complete. ${products.length} products analyzed in this tab. The pasted JSON was not included in validation telemetry.`, "success");
  } catch (error) {
    void recordEvent("CHECK_FAILED", {
      mode: "manual_local_json",
      channel: targetChannel.value,
      failure_code: "LOCAL_JSON_INVALID"
    });
    setMessage(manualMessage, `Could not analyze the JSON: ${error.message}`, "error");
  }
});

$("fix-interest").addEventListener("click", async () => {
  const delivered = await recordEvent("FIX_INTEREST", {
    score_band: latestReport ? scoreBand(latestReport.score) : "unknown"
  });
  intentMessage.textContent = delivered
    ? "Thanks — your fix interest was recorded with minimal validation telemetry. Our submitted payload excludes your store URL, product data, credentials, and payment information; Netlify Forms may attach standard request metadata such as IP address and user agent."
    : "Thanks — your fix interest is noted in this browser session. Validation telemetry delivery was unavailable, and no sensitive store data was sent.";
  intentMessage.className = "intent-message success";
});

$("price-interest").addEventListener("click", async () => {
  const delivered = await recordEvent("PRICE_INTENT", {
    concept: "future_19_usd_month_pilot",
    charge_today: false
  });
  intentMessage.textContent = delivered
    ? "Thanks — future pilot interest was recorded with minimal validation telemetry. No payment method was requested or collected; Netlify Forms may attach standard request metadata such as IP address and user agent."
    : "Thanks — future pilot interest is noted in this browser session. Validation telemetry delivery was unavailable; no payment method was requested or collected.";
  intentMessage.className = "intent-message success";
});

$("copy-report").addEventListener("click", async () => {
  if (!latestReport) return;
  const lines = [
    "Shopify Product Feed Health Check — Actionable Report",
    `Score: ${latestReport.score}/100`,
    `Products checked: ${latestReport.product_count}`,
    `Primary channel: ${latestReport.channel_label}`,
    `Repair summary: ${prioritySummary(latestReport)}`,
    "",
    ...latestReport.findings.flatMap(item => [
      `${item.priority} · ${item.severity.toUpperCase()}: ${item.title} — ${item.items.length} affected`,
      `Why: ${item.why}`,
      `Channel impact: ${item.channelImpactText}`,
      `Repair: ${item.repairSteps.join(" | ")}`,
      `Avoid: ${item.badExample}`,
      `Better: ${item.goodExample}`,
      ""
    ]),
    "Re-check after repairs using the same deterministic rules.",
    "Coverage note: this public-data check does not inspect authenticated Merchant Center diagnostics, policy flags, private inventory, shipping configuration, or account-level disapprovals.",
    "Service note: informational product-data guidance only; no ranking, ad approval, traffic, or sales guarantee."
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    intentMessage.textContent = "Actionable report copied.";
    intentMessage.className = "intent-message success";
  } catch {
    intentMessage.textContent = "Clipboard access was blocked by your browser. No data was sent elsewhere.";
    intentMessage.className = "intent-message";
  }
});

void recordEvent("PAGE_VIEW");
