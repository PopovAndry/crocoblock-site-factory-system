"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createModel,
  technicalDetailsAreSanitized,
  validateDetails
} = require("../src/ui/create-website-ui");

function details(overrides) {
  return Object.assign({
    project_name: "Kyiv Realty CEO Demo",
    agency_name: "Kyiv Realty",
    city: "Kyiv",
    phone: "+380 44 555 01 01",
    email: "hello@kyivrealty.example"
  }, overrides || {});
}

test("Create Website UI model follows type, details, review, and progress steps", () => {
  const model = createModel();
  assert.equal(model.state.step, "type");
  model.selectType();
  assert.equal(model.state.step, "details");
  model.review(details());
  assert.equal(model.state.step, "review");
  assert.equal(model.state.details.agency_name, "Kyiv Realty");
  model.edit();
  assert.equal(model.state.step, "details");
  model.progress({ status: "running" });
  assert.equal(model.state.step, "progress");
});

test("Create Website UI validation reports field-level errors", () => {
  const errors = validateDetails(details({ project_name: "../demo", email: "bad", phone: "123" }));
  assert.equal(errors.project_name, "Use a project name, not a path.");
  assert.equal(errors.email, "Enter a valid email address.");
  assert.equal(errors.phone, "Enter a valid phone number.");
});

test("Technical details sanitizer rejects paths, secrets, commands, and operation IDs", () => {
  assert.equal(technicalDetailsAreSanitized([{ stage: "Starting WordPress", status: "active" }]), true);
  for (const unsafe of ["C:\\runtime", "password=hidden", "docker command", "operation_id=op-123"]) {
    assert.equal(technicalDetailsAreSanitized([{ stage: unsafe, status: "failed" }]), false);
  }
});

test("Launcher markup contains the complete CEO flow and no selectable fake vertical", () => {
  const server = fs.readFileSync(path.resolve(__dirname, "../src/server.js"), "utf8");
  const ui = fs.readFileSync(path.resolve(__dirname, "../src/ui/create-website-ui.js"), "utf8");
  assert.match(server, /id=\\"create-website-button\\"/);
  assert.match(ui, /Business Details/);
  assert.match(ui, /30 demonstration properties/);
  assert.match(ui, /We couldn’t finish creating the website/);
  assert.match(ui, /Your website is ready/);
  assert.match(ui, /Open Website/);
  assert.doesNotMatch(ui, /Travel|Restaurant|Ecommerce/);
});
