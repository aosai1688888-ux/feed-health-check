"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

// Execute the actual app without a browser or any network/telemetry sink.
// Description fixtures are plain text; DOM stubs are only bootstrapping.
const sourcePath = process.env.FEED_HEALTH_TEST_SOURCE || path.join(__dirname, "..", "app.js");
const context = vm.createContext({
  URL, crypto: webcrypto,
  document: {
    getElementById: () => ({ addEventListener() {}, value: "general" }),
    createElement: () => ({ innerHTML: "", get textContent() { return this.innerHTML; } })
  }
});
vm.runInContext(fs.readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });
const audit = context.auditProducts;
const product = () => ({
  title: "Merino sweater",
  body_html: "A factual plain-text description of a merino wool sweater with regular fit, ribbed cuffs and machine-washable construction.",
  vendor: "Example Manufacturer", product_type: "Sweaters",
  images: [{ src: "https://cdn.example.com/sweater.jpg", alt: "Navy merino sweater" }],
  variants: [{ sku: "SWEATER-NAVY-M", price: "29.00", barcode: "123456789012" }]
});
const report = item => audit([item], "local synthetic regression fixture", "general");
const hasFinding = (r, key) => r.findings.some(f => f.key === key);

test("complete factual fixture keeps 100 score", () => {
  const r = report(product());
  assert.equal(r.score, 100);
  assert.equal(r.findings.length, 0);
});
for (const value of ["29USD", "29.00 trailing", "Infinity", "NaN", "0x10", "1e3", "", " ", "0", "0.00", "-1", null, true, Infinity]) {
  test("invalid/non-positive price is a critical finding: " + String(value), () => {
    const item = product(); item.variants[0].price = value;
    const r = report(item);
    assert.equal(hasFinding(r, "price"), true);
    assert.equal(r.score, 90);
    assert.equal(r.findings.find(f => f.key === "price").severity, "critical");
  });
}
for (const value of ["29", "29.00", " 29.00 ", "0.50", ".50", 29, 0.5]) {
  test("finite positive decimal price remains accepted: " + String(value), () => {
    const item = product(); item.variants[0].price = value;
    assert.equal(hasFinding(report(item), "price"), false);
  });
}
test("every variant must have a valid price", () => {
  const item = product(); item.variants.push({ sku: "SECOND", price: "29USD", barcode: "123" });
  assert.equal(hasFinding(report(item), "price"), true);
});
for (const image of [null, {}, { alt: "Navy merino sweater" }, { src: "", alt: "Navy merino sweater" }, { src: "not-a-url", alt: "Navy merino sweater" }, { src: "javascript:alert(1)", alt: "Navy merino sweater" }, { src: "data:image/png;base64,AA", alt: "Navy merino sweater" }, { src: "https://name:password@cdn.example.com/photo.jpg", alt: "Navy merino sweater" }]) {
  test("metadata alone or unusable image source is not an image: " + JSON.stringify(image), () => {
    const item = product(); item.images = [image];
    const r = report(item);
    assert.equal(hasFinding(r, "image"), true);
    assert.equal(hasFinding(r, "alt"), true);
    assert.equal(r.score, 75);
  });
}
test("absolute public HTTP source retains image metadata completeness", () => {
  const item = product(); item.images[0].src = "http://cdn.example.com/photo.jpg";
  assert.equal(hasFinding(report(item), "image"), false);
});
test("a valid image among invalid metadata still satisfies image presence", () => {
  const item = product(); item.images.push({ src: "", alt: "Invalid metadata" });
  assert.equal(hasFinding(report(item), "image"), false);
});
test("missing alt on a valid image remains a distinct warning", () => {
  const item = product(); delete item.images[0].alt;
  const r = report(item);
  assert.equal(hasFinding(r, "image"), false);
  assert.equal(hasFinding(r, "alt"), true);
  assert.equal(r.score, 90);
});
test("combined malformed price and missing image produces real repair priorities", () => {
  const item = product(); item.variants[0].price = "29USD"; item.images = [{ alt: "Navy merino sweater" }];
  const r = report(item);
  assert.equal(r.score, 65);
  assert.equal(r.counts.critical, 2);
  assert.equal(hasFinding(r, "price"), true);
  assert.equal(hasFinding(r, "image"), true);
});
