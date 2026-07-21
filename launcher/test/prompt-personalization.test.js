"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  derivePromptPersonalization
} = require("../src/prompt-personalization");

test("canonical create instruction resolves to the canonical Kyiv brokerage fields", () => {
  const result = derivePromptPersonalization(
    "Create the canonical Kyiv Turquoise Realty real estate website for Kyiv with premium apartments and family homes."
  );

  assert.equal(result.source, "local_interpreter");
  assert.equal(result.provider_called, false);
  assert.equal(result.fields.agency_name, "Kyiv Turquoise Realty");
  assert.equal(result.fields.hero_title, "Find Your Place in Kyiv");
  assert.equal(result.fields.hero_subtitle, "Explore apartments, houses, and commercial spaces across Kyiv.");
  assert.equal(result.fields.hero_cta_text, "Browse properties");
});

test("instruction verbs do not become part of agency_name", () => {
  const result = derivePromptPersonalization(
    "Generate Harbor Family Realty real estate website for Mykolaiv with apartments near parks."
  );

  assert.equal(result.fields.agency_name, "Harbor Family Realty");
  assert.ok(!result.fields.agency_name.startsWith("Generate "));
});

test("generic create instructions do not reduce the agency name to an article", () => {
  const result = derivePromptPersonalization(
    "Create a real estate site for Kyiv apartments"
  );

  assert.equal(result.fields.agency_name, "Kyiv Realty");
  assert.equal(result.fields.hero_title, "Kyiv Realty - Premium Real Estate in Kyiv");
});

test("quoted agency names remain exact", () => {
  const result = derivePromptPersonalization(
    "Build a real estate website for agency \"Aurora Estates\" in Lviv with premium apartments."
  );

  assert.equal(result.fields.agency_name, "Aurora Estates");
  assert.equal(result.fields.hero_title, "Aurora Estates - Premium Real Estate in Lviv");
});

test("agency named syntax excludes the syntax token from the agency name", () => {
  const result = derivePromptPersonalization(
    "Create a professional Kyiv real estate website for an agency named Kyiv Realty."
  );

  assert.equal(result.fields.agency_name, "Kyiv Realty");
  assert.notEqual(result.fields.agency_name, "named Kyiv Realty");
});

test("invalid explicit agency named candidates fail closed without generic fallback parsing", () => {
  const result = derivePromptPersonalization(
    "Create a professional Kyiv real estate website for an agency named A."
  );

  assert.equal(result.fields.agency_name, "Kyiv Realty");
  assert.notEqual(result.fields.agency_name, "named A");
});

test("generic one-letter agency candidates remain rejected", () => {
  const result = derivePromptPersonalization(
    "Create a professional Kyiv real estate website for an agency A."
  );

  assert.equal(result.fields.agency_name, "Kyiv Realty");
});
