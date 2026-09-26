FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js first-payment.js first-payment.css first-payment-offer.v1.json checkout-config.v1.json styles.css collector.css /usr/share/nginx/html/
COPY privacy.html terms.html contact.html robots.txt sitemap.xml /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
