"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const source = process.env.FEEDHEALTH_SANDBOX_SMOKE_URL || "http://127.0.0.1:18091/";
    assert.match(source, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    await page.goto(source, { waitUntil: "domcontentloaded", timeout: 30000 });
    try {
      await page.waitForFunction(
        () => document.querySelector("#buy-diagnosis") !== null,
        null, { timeout: 12000 }
      );
    } catch {
      const status = await page.evaluate(async () => {
        const [offer, config] = await Promise.all([
          fetch("/first-payment-offer.v1.json").then(r => r.status).catch(() => 0),
          fetch("/checkout-config.v1.json").then(r => r.status).catch(() => 0)
        ]);
        return {
          panelExists: !!document.querySelector(".cta-panel"),
          buttonExists: !!document.querySelector("#buy-diagnosis"),
          appLoaded: typeof initializeFirstPayment === "function",
          domReady: document.readyState,
          offerHttp: offer,
          checkoutHttp: config,
          scripts: Array.from(document.scripts).map(x => x.getAttribute("src")).filter(Boolean)
        };
      });
      console.error("FEED_SANDBOX_BROWSER_DOM_DIAGNOSTIC=" + JSON.stringify(status));
      throw Error("BUY_BUTTON_NOT_RENDERED");
    }
    const result = await page.evaluate(async () => {
      const config = await fetch("/checkout-config.v1.json", { cache: "no-store" }).then(r => r.json());
      if (!isSandboxPaddleCheckout(config)) return "CANDIDATE_CONFIG_REJECTED";
      try {
        const paddle = await loadSandboxPaddle();
        paddle.Environment.set("sandbox");
        paddle.Initialize({ token: config.paddle.client_side_token });
        const preview = await paddle.PricePreview({
          items: [{ priceId: config.paddle.price_id, quantity: 1 }],
          address: { countryCode: "US" }
        });
        // PricePreview has LINE ITEMS, not transaction-level grand totals.
        // Verify the actual catalog's product, price, 4900-cent USD unit amount
        // and non-recurring billingCycle == null. Do not trust local label only.
        const lines = preview?.data?.details?.lineItems;
        if (!Array.isArray(lines) || lines.length !== 1) return "PRICE_PREVIEW_LINE_ITEM_SHAPE_UNEXPECTED";
        const price = lines[0]?.price;
        if (!price || price.id !== config.paddle.price_id) return "PRICE_ID_MISMATCH";
        if (price.productId !== config.paddle.product_id) return "PRODUCT_ID_MISMATCH";
        if (price.unitPrice?.currencyCode !== "USD" || String(price.unitPrice?.amount) !== "4900") return "PRICE_CENTS_OR_CURRENCY_MISMATCH";
        if (price.billingCycle != null || price.trialPeriod != null) return "RECURRING_OR_TRIAL_NOT_PERMITTED";
        return "PRICE_PREVIEW_READY";
      } catch {
        return "PADDLE_BROWSER_OR_PROVIDER_PREVIEW_FAILED";
      }
    });
    assert.equal(result, "PRICE_PREVIEW_READY", "Paddle price API preflight not yet verified: " + result);
    console.log("REAL_PROVIDER_PADDLE_SANDBOX_PRICE_PREVIEW=PASS");
    console.log("TEST_CARD_NOT_USED=TRUE");
    console.log("PAYMENT_COMPLETE_NOT_CLAIMED=TRUE");
    console.log("PAID_AI_DELIVERY_NOT_CLAIMED=TRUE");
  } finally {
    await browser.close();
  }
})().catch(error => {
  // No token, price response or provider body is included in these logs.
  console.error("PADDLE_SANDBOX_BROWSER_PREVIEW=HOLD", String(error.message).slice(0, 170));
  process.exitCode = 1;
});
