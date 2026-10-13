#!/bin/sh
# Transport only inside the existing Railway website. Never payment authority.
set -eu
umask 077
output=/etc/nginx/feedhealth-locations.conf
template=/etc/nginx/feedhealth-proxy.template
disabled() {
    : > "$output"
    for route in /webhooks/paddle /v1/feedhealth/checkout-intents /v1/feedhealth/reports/read /v1/feedhealth/reports/ack; do
        printf 'location = %s { access_log off; return 503; }\n' "$route" >> "$output"
    done
}
disabled
case "${FEEDHEALTH_TRANSPORT_ENABLED:-0}" in
    0) exit 0 ;;
    1) ;;
    *) echo 'FeedHealth transport: invalid mode' >&2; exit 1 ;;
esac
# Single-owner release requires explicit activation in addition to scoped TLS and Access credentials.
# This is NOT evidence of provider approval, customer payment or completed delivery.
[ "${FEEDHEALTH_TRANSPORT_OWNER_RELEASE:-}" = "OWNER_APPROVED" ] || {
    echo 'FeedHealth transport: owner release not approved' >&2; exit 1;
}
host="${FEEDHEALTH_GATEWAY_INGRESS_HOST:-}"
case "$host" in
    ""|*[!a-z0-9.-]*|feed.qianwuai.com|.*|*..*|*.) echo 'FeedHealth transport: invalid ingress host' >&2; exit 1 ;;
    *.qianwuai.com) ;;
    *) echo 'FeedHealth transport: ingress outside approved domain' >&2; exit 1 ;;
esac
# Service token is scoped to a separate Access application on the existing
# cloudflared tunnel. Never use the Group master token or Paddle signing key.
for value in "${FEEDHEALTH_ACCESS_CLIENT_ID:-}" "${FEEDHEALTH_ACCESS_CLIENT_SECRET:-}"; do
    case "$value" in
        ""|*[!A-Za-z0-9_.-]*) echo 'FeedHealth transport: invalid scoped credential' >&2; exit 1 ;;
    esac
    [ "${#value}" -ge 20 ] && [ "${#value}" -le 256 ] || {
        echo 'FeedHealth transport: invalid scoped credential length' >&2; exit 1;
    }
done
export FEEDHEALTH_GATEWAY_INGRESS_HOST FEEDHEALTH_ACCESS_CLIENT_ID FEEDHEALTH_ACCESS_CLIENT_SECRET
# Only these three variables are substituted. Nginx request variables survive.
envsubst '${FEEDHEALTH_GATEWAY_INGRESS_HOST} ${FEEDHEALTH_ACCESS_CLIENT_ID} ${FEEDHEALTH_ACCESS_CLIENT_SECRET}' < "$template" > "$output"
chmod 600 "$output"
