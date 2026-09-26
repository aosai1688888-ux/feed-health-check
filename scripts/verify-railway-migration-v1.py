#!/usr/bin/env python3
from pathlib import Path
r = Path(__file__).resolve().parents[1]
src = lambda name: (r/name).read_text(encoding="utf-8")
for f in ("Dockerfile","nginx.conf","index.html","app.js","first-payment.js","checkout-config.v1.json","privacy.html","terms.html","contact.html","robots.txt","sitemap.xml"):
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
for p in ("index.html","privacy.html","terms.html","contact.html"):
    assert "深圳市乾五数字科技有限公司" in src(p),p
print("FEED_RAILWAY_SITE_CONTRACT=PASS")
