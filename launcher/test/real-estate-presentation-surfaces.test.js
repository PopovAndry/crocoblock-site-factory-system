"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");
const renderAdapter = fs.readFileSync(path.join(repoRoot, "wordpress-plugin", "includes", "adapters", "render-adapter.php"), "utf8");
const singleAdapter = fs.readFileSync(path.join(repoRoot, "wordpress-plugin", "includes", "adapters", "single-adapter.php"), "utf8");

test("Archive uses the existing property cards, filters, and shared site chrome", () => {
  assert.match(renderAdapter, /factory-property-search/);
  assert.match(renderAdapter, /render_property_results_header/);
  assert.match(renderAdapter, /repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(renderAdapter, /render_property_card\( get_the_ID\(\), \$style_tokens, 'grid'/);
  assert.match(renderAdapter, /\$this->render_home_site_header\( \$blueprint, factory_rest_get_real_estate_public_brand/);
  assert.equal(renderAdapter.split('data-factory-component="site-header"').length - 1, 1);
  assert.equal(renderAdapter.split('data-factory-component="site-footer"').length - 1, 1);
});

test("Property Single reuses shared chrome and keeps its customer-facing facts", () => {
  assert.match(singleAdapter, /new Factory_Render_Adapter\(\)/);
  assert.match(singleAdapter, /render_home_site_header\( \$blueprint, \$brand \)/);
  assert.match(singleAdapter, /Back to properties/);
  assert.match(singleAdapter, /Request viewing/);
  assert.match(singleAdapter, /Property description/);
  assert.match(singleAdapter, /Property details/);
  assert.match(singleAdapter, /render_generated_footer\( \$blueprint \)/);
  assert.doesNotMatch(singleAdapter, /private function render_generated_footer/);
});

test("Contact renders actionable agency details without an unavailable form", () => {
  const contactStart = renderAdapter.indexOf("private function render_contact_page_content");
  const contactEnd = renderAdapter.indexOf("public function render_request_viewing_shortcode", contactStart);
  const contactRenderer = renderAdapter.slice(contactStart, contactEnd);

	assert.match(contactRenderer, /\$brand\s*=\s*factory_rest_get_real_estate_public_brand\( \$blueprint \)/);
	assert.match(contactRenderer, /\$title\s*=\s*factory_rest_build_real_estate_contact_title\( \$brand \)/);
  assert.match(contactRenderer, /href="tel:/);
  assert.match(contactRenderer, /esc_url\( \$email_href \)/);
  assert.match(contactRenderer, /Location/);
  assert.match(contactRenderer, /Kyiv, Ukraine/);
  assert.match(contactRenderer, /Email Kyiv Realty/);
  assert.match(contactRenderer, /factory-contact-page__actions/);
	assert.match(contactRenderer, /factory-contact-page__label/);
	assert.match(contactRenderer, /factory-contact-page__value/);
  assert.doesNotMatch(contactRenderer, /\[factory_request_viewing\]/);
  assert.match(renderAdapter, /Contact inquiry CTA missing from Contact page\./);
  assert.match(renderAdapter, /factory-contact-page__actions/);
  assert.match(renderAdapter, /Contact email inquiry CTA rendered on Contact page\./);
	assert.match(renderAdapter, /factory-contact-page__label[^']*display:block/);
	assert.match(renderAdapter, /factory-generated-footer a[^']*display:block/);
	assert.doesNotMatch(contactRenderer, /style="display: block; color:/);
});

test("Presentation styles cover archive, contact, and Single responsive geometry", () => {
  assert.match(renderAdapter, /factory-generated-properties-page #masthead/);
  assert.match(renderAdapter, /factory-generated-contact-page #masthead/);
  assert.match(renderAdapter, /factory-generated-property-single-page #masthead/);
  assert.match(renderAdapter, /factory-contact-page__info-grid/);
  assert.match(renderAdapter, /@media\(max-width:620px\)/);
  assert.doesNotMatch(renderAdapter, /<style>body\.front-page/);
});
