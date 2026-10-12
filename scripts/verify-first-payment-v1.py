#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

def load(path: str):
    return json.loads(read(path))

def require(condition: bool, marker: str) -> None:
    if not condition:
        raise SystemExit(f"{marker}=FAIL")
    print(f"{marker}=PASS")


offer = load("first-payment-offer.v1.json")
checkout = load("checkout-config.v1.json")
index = read("index.html")
js = read("first-payment.js")

require(offer["authority_id"] == "QIANWU-QIHANG-FIRST-PAYMENT-REVENUE-ENGINE-V1.0", "FIRST_PAYMENT_AUTHORITY_BINDING")
require(offer["sku"] == "VERIFIED_FEED_DIAGNOSIS", "FIRST_PAYMENT_SKU")
require(offer["default_test_price"] == 49 and offer["price_test_band"] == {"min": 29, "max": 79}, "FIRST_PAYMENT_PRICE_EXPERIMENT")
require(offer["payment_before_delivery"] is True, "FIRST_PAYMENT_BEFORE_DELIVERY")
require(offer["checkout_policy"]["client_may_assert_payment_success"] is False, "FIRST_PAYMENT_CLIENT_SUCCESS_DENIED")
require(offer["checkout_policy"]["trusted_server_confirmation_required"] is True, "FIRST_PAYMENT_TRUSTED_SUCCESS_REQUIRED")

require(checkout["enabled"] is False, "FIRST_PAYMENT_CHECKOUT_FAIL_CLOSED")
require(checkout["provider"] == "UNBOUND", "FIRST_PAYMENT_PROVIDER_UNBOUND")
require(checkout["browser_may_assert_success"] is False, "FIRST_PAYMENT_BROWSER_SUCCESS_DENIED")
require(checkout["success_confirmation"] == "TRUSTED_SERVER_ONLY", "FIRST_PAYMENT_SERVER_CONFIRMATION_ONLY")

for token in ("first-payment.css", "first-payment.js", "feed-health-authority", "event_id", "checkout_ref", "payment_state"):
    require(token in index, f"FIRST_PAYMENT_INDEX_{token.upper().replace('-', '_').replace('.', '_')}")

require("PAYMENT_SUCCEEDED" not in js, "FIRST_PAYMENT_BROWSER_PAYMENT_SUCCEEDED_ABSENT")
require("localStorage" not in js and "sessionStorage" not in js and "document.cookie" not in js, "FIRST_PAYMENT_NO_PERSISTENT_BROWSER_TRACKING")
for forbidden_field in ('store_url:', 'storefront_url:', 'merchant_url:', 'product_payload:', 'products_json:'):
    require(forbidden_field not in js, f"FIRST_PAYMENT_TELEMETRY_FIELD_{forbidden_field[:-1].upper()}_ABSENT")
require('url.protocol !== "https:"' in js, "FIRST_PAYMENT_HTTPS_CHECKOUT_ONLY")
require(
    "reservePaidDiagnosisBeforeCheckout(" in js
    and 'checkout_ref: checkoutRef' in js
    and '"Idempotency-Key": checkoutRef' in js
    and 'await reservePaidDiagnosisBeforeCheckout(checkout, checkoutRef, email, consent);' in js
    and 'Payment is withheld until secure AI report delivery is verified.' in js,
    "FIRST_PAYMENT_CHECKOUT_REFERENCE_BOUND"
)
require("No payment has been taken" in js, "FIRST_PAYMENT_FAIL_CLOSED_USER_MESSAGE")
pricing = read("pricing.html")
refunds = read("refund.html")
terms = read("terms.html")
privacy = read("privacy.html")
dockerfile = read("Dockerfile")
for page, href in (("pricing", "/pricing.html"), ("refund", "/refund.html"), ("terms", "/terms.html"), ("privacy", "/privacy.html")):
    require(href in index, f"FIRST_PAYMENT_{page.upper()}_INDEX_LINK")
    require(f"{page}.html" in dockerfile,
            f"FIRST_PAYMENT_{page.upper()}_SHIPPED")
require("US$49" in pricing and "one-time" in pricing.lower() and "not yet available" in pricing.lower(),
        "FIRST_PAYMENT_PRICING_TRUTHFUL")
require("paddle.net" in refunds and "www.paddle.com/legal/refund-policy" in refunds,
        "FIRST_PAYMENT_REFUND_POLICY_LINKED")
require("not yet live" in terms.lower() and "not yet live" in privacy.lower(),
        "FIRST_PAYMENT_PAID_POLICY_NOT_FALSE_LIVE")
require("Paddle" in pricing and "checkout" in pricing.lower(),
        "FIRST_PAYMENT_PRICE_PAYMENT_BOUNDARY")

print("FIRST_PAYMENT_NO_STORE_URL_TELEMETRY=PASS")
print("FIRST_PAYMENT_P0B_STATIC_GATE=PASS")
print("FIRST_PAYMENT_P0C_HANDOFF_STATIC_GATE=PASS")
print("REAL_PROVIDER_BINDING_REQUIRED=TRUE")
print("PRODUCTION_PAYMENT_SUCCESS_CLAIM=DENIED")
