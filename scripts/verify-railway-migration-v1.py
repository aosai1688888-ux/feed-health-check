#!/usr/bin/env python3
from pathlib import Path
r = Path(__file__).resolve().parents[1]
src = lambda name: (r/name).read_text(encoding="utf-8")
for f in ("Dockerfile","nginx.conf","index.html","app.js","first-payment.js","checkout-config.v1.json","privacy.html","terms.html","contact.html","pricing.html","refund.html","robots.txt","sitemap.xml"):
    assert (r/f).is_file(), f
assert "https://feed.qianwuai.com/" in src("index.html")
assert "https://feed.qianwuai.com/" in src("sitemap.xml")
assert "data-netlify" not in src("index.html")
assert 'fetch("/", {' not in src("app.js")
assert 'fetch("/", {' not in src("first-payment.js")
assert '"enabled": false' in src("checkout-config.v1.json")
assert '"provider": "UNBOUND"' in src("checkout-config.v1.json")
assert '"success_confirmation": "TRUSTED_SERVER_ONLY"' in src("checkout-config.v1.json")
assert "noindex" in src("nginx.conf") and "X-Content-Type-Options" in src("nginx.conf")
assert "mailto:feedhealth@qianwuai.com" in src("app.js")
for p in ("index.html","privacy.html","terms.html","contact.html","pricing.html","refund.html"):
    assert "深圳市乾五数字科技有限公司" in src(p),p
# Regression: the original buyer reservation gateway rejects the booking
# unless the browser's Idempotency-Key equals checkout_ref. The Railway nginx
# proxy intentionally disables all headers, so this single one must be allowed.
proxy = src("feedhealth-proxy.template")
start = proxy.index("location = /v1/feedhealth/checkout-intents {")
end = proxy.index("location = /v1/feedhealth/reports/read {", start)
intake = proxy[start:end]
assert "proxy_pass_request_headers off;" in intake
assert "proxy_set_header Idempotency-Key $http_idempotency_key;" in intake
assert "proxy_set_header CF-Access-Client-Id" in intake
assert "proxy_set_header Origin $http_origin;" in intake
assert "proxy_set_header Sec-Fetch-Site $http_sec_fetch_site;" in intake
assert "proxy_set_header Authorization" not in intake
# Intermittent 502 regression: preserve a single, non-retrying checkout/webhook
# route while disabling Nginx's passive upstream quarantine after one failure.
transport = src("scripts/40-feedhealth-transport.sh")
assert '00-feedhealth-upstream.conf' in transport
assert 'server %s:443 max_fails=0;' in transport
assert 'chmod 600 "$upstream"' in transport
assert ': > "$upstream"' in transport  # absent when fail-closed
assert proxy.count('proxy_pass https://feedhealth_gateway_edge/') == 4
assert proxy.count('proxy_next_upstream off;') == 4
assert 'proxy_pass https://'+chr(36)+'{FEEDHEALTH_GATEWAY_INGRESS_HOST}/' not in proxy
assert proxy.count('proxy_ssl_name '+chr(36)+'{FEEDHEALTH_GATEWAY_INGRESS_HOST};') == 4
print("FEED_RAILWAY_SITE_CONTRACT=PASS")
