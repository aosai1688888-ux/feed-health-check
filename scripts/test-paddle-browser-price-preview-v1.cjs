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
    await page.waitForFunction(
      () => document.querySelector("#buy-diagnosis") !== null,
      { timeout: 30000 }
    );
    const result = await page.evaluate(async () => {
      const config = await fetch("/checkout-config.v1.json", { cache: "no-store" }).then(r => r.json());
      if (!isSandboxPaddleCheckout(config)) return "CANDIDATE_CONFIG_REJECTED";
      try {
        const paddle = await loadSandboxPaddle();
        paddle.Environment.set("sandbox");
        paddle.Initialize({ token: config.paddle.client_side_token });
        const preview = await paddle.PricePreview({
          items: [{ priceId: config.paddle.price_id, quantity: 1 }]
        });
        if (preview && preview.data && preview.data.details && preview.data.details.totals) return "PRICE_PREVIEW_READY";
        return "PRICE_PREVIEW_UNEXPECTED_SHAPE";
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
