"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createProjectScaffold
} = require("../src/project-store");
const {
  AGENT_AUTH_SECRET_RELATIVE_PATH,
  agentAuthSecretPath,
  ensureAgentSigningCredential,
  hardenCredentialPath,
  parseWhoamiCsvSid,
  readAgentSigningCredential,
  redactAgentSigningCredential,
  resolveCurrentWindowsUserSid,
  requireAgentSigningCredential
} = require("../src/agent-credential-store");
const {
  SIGNED_AUTH_VERSION
} = require("../src/agent-signed-auth");

let portCounter = 28000;

function projectsRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-agent-auth-b2-"));
}

function tempProject(root, slug) {
  const scaffold = createProjectScaffold({
    name: slug,
    slug,
    port: portCounter += 1,
    projectsRoot: root
  });
  return {
    project: scaffold.project,
    runtimePath: scaffold.project.runtime_path,
    projectsRoot: root
  };
}

function readText(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

function phpBinary() {
  const osPanelPhp = "C:\\OSPanel\\modules\\php\\PHP_8.1\\php.exe";
  if (fs.existsSync(osPanelPhp)) {
    return osPanelPhp;
  }
  const probe = spawnSync("php", ["-v"], { encoding: "utf8" });
  return probe.status === 0 ? "php" : null;
}

const WINDOWS_USER_SID = "S-1-5-21-1111111111-2222222222-3333333333-1001";

function validWindowsAclSummary() {
  return {
    protected: true,
    owner_sid: WINDOWS_USER_SID,
    access: [
      { sid: WINDOWS_USER_SID, rights: "FullControl", type: "Allow", inherited: false },
      { sid: "S-1-5-18", rights: "FullControl", type: "Allow", inherited: false },
      { sid: "S-1-5-32-544", rights: "FullControl", type: "Allow", inherited: false }
    ]
  };
}

function windowsAclMock(options = {}) {
  const calls = [];
  const aclSummary = options.invalidSummary || validWindowsAclSummary();
  return {
    calls,
    acl: {
      platform: "win32",
      currentUserSid: options.currentUserSid === false ? null : WINDOWS_USER_SID,
      runCommand(executable, args) {
        calls.push({ executable, args: args.slice() });
        if (executable === "whoami.exe") {
          return {
            status: 0,
            stdout: `"INV5168\\cactus","${WINDOWS_USER_SID}"\r\n`,
            stderr: ""
          };
        }
        if (executable === "powershell.exe") {
          return {
            status: options.invalidJson ? 0 : 0,
            stdout: options.invalidJson ? "not-json" : JSON.stringify(aclSummary),
            stderr: ""
          };
        }
        if (executable === "icacls.exe") {
          if (options.failApply && args.includes("/inheritance:r")) {
            return { status: 1, stdout: "", stderr: "icacls failed" };
          }
          if (options.failRemove && args.includes("/remove:g")) {
            return { status: 1, stdout: "", stderr: "ACE not present" };
          }
          return { status: 0, stdout: "processed", stderr: "" };
        }
        return { status: 127, stdout: "", stderr: "unexpected executable" };
      }
    }
  };
}

function commandCalls(mock, executable) {
  return mock.calls.filter((call) => call.executable === executable);
}

test("project credential store creates one unique project-local secret and returns existing credential", () => {
  const root = projectsRoot();
  const projectA = tempProject(root, "project-a");
  const projectB = tempProject(root, "project-b");

  const first = ensureAgentSigningCredential(projectA);
  const second = ensureAgentSigningCredential(projectA);
  const third = ensureAgentSigningCredential(projectB);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.credential.key_id, second.credential.key_id);
  assert.equal(first.credential.signing_secret, second.credential.signing_secret);
  assert.notEqual(first.credential.key_id, third.credential.key_id);
  assert.notEqual(first.credential.signing_secret, third.credential.signing_secret);
  assert.equal(path.basename(agentAuthSecretPath(projectA)), "agent-auth.json");
  assert.equal(agentAuthSecretPath(projectA).endsWith(AGENT_AUTH_SECRET_RELATIVE_PATH), true);
  assert.equal(readAgentSigningCredential(projectA).contract_version, SIGNED_AUTH_VERSION);
});

test("Windows SID parsing and resolver use fixed executable arguments", () => {
  const mock = windowsAclMock({ currentUserSid: false });
  assert.equal(parseWhoamiCsvSid(`"INV5168\\cactus","${WINDOWS_USER_SID}"\r\n`), WINDOWS_USER_SID);
  assert.equal(resolveCurrentWindowsUserSid(mock.acl), WINDOWS_USER_SID);
  assert.deepEqual(commandCalls(mock, "whoami.exe")[0].args, ["/user", "/fo", "csv", "/nh"]);
});

test("new credential creation hardens secrets directory, temporary file, and final file", () => {
  const root = projectsRoot();
  const project = tempProject(root, "acl-create-project");
  const mock = windowsAclMock({ failRemove: true });
  const created = ensureAgentSigningCredential(project, { acl: mock.acl });
  const icaclsCalls = commandCalls(mock, "icacls.exe");
  const powershellCalls = commandCalls(mock, "powershell.exe");
  const secret = created.credential.signing_secret;

  assert.equal(created.created, true);
  assert.ok(icaclsCalls.length >= 9);
  assert.ok(powershellCalls.length >= 3);
  assert.ok(icaclsCalls.some((call) => call.args.includes("/inheritance:r")));
  assert.ok(icaclsCalls.some((call) => call.args.includes("/grant:r")
    && call.args.includes("*" + WINDOWS_USER_SID + ":F")
    && call.args.includes("*S-1-5-18:F")
    && call.args.includes("*S-1-5-32-544:F")));
  assert.ok(icaclsCalls.some((call) => call.args.includes("/remove:g")
    && call.args.includes("*S-1-5-32-545")
    && call.args.includes("*S-1-5-11")
    && call.args.includes("*S-1-1-0")));
  assert.equal(mock.calls.some((call) => JSON.stringify(call.args).includes(secret)), false);
  assert.equal(fs.existsSync(created.path), true);
  assert.equal(fs.existsSync(created.path + ".tmp"), false);
});

test("existing credential load remediates secrets directory and credential ACL", () => {
  const root = projectsRoot();
  const project = tempProject(root, "acl-read-project");
  const created = ensureAgentSigningCredential(project);
  const mock = windowsAclMock();
  const loaded = readAgentSigningCredential(project, { acl: mock.acl });

  assert.equal(loaded.key_id, created.credential.key_id);
  assert.ok(commandCalls(mock, "icacls.exe").some((call) => call.args.includes("/inheritance:r")));
  assert.ok(commandCalls(mock, "powershell.exe").length >= 2);
});

test("Windows ACL apply and verification failures fail closed", () => {
  const root = projectsRoot();
  const applyProject = tempProject(root, "acl-apply-fail-project");
  const verifyProject = tempProject(root, "acl-verify-fail-project");
  const applyMock = windowsAclMock({ failApply: true });
  const verifyMock = windowsAclMock({
    invalidSummary: {
      protected: false,
      owner_sid: WINDOWS_USER_SID,
      access: [
        { sid: WINDOWS_USER_SID, rights: "FullControl", type: "Allow", inherited: true },
        { sid: "S-1-5-11", rights: "ReadAndExecute", type: "Allow", inherited: true }
      ]
    }
  });

  assert.throws(
    () => ensureAgentSigningCredential(applyProject, { acl: applyMock.acl }),
    (error) => error.code === "agent_signed_acl_apply_failed"
  );
  assert.throws(
    () => ensureAgentSigningCredential(verifyProject, { acl: verifyMock.acl }),
    (error) => error.code === "agent_signed_acl_verification_failed"
  );
});

test("non-Windows hardening keeps chmod-based behavior", () => {
  const filePath = path.join(projectsRoot(), "credential.json");
  fs.writeFileSync(filePath, "{}\n", "utf8");
  const chmodCalls = [];

  hardenCredentialPath(filePath, {
    platform: "linux",
    statSync(target) {
      assert.equal(target, filePath);
      return { isDirectory: () => false };
    },
    chmodSync(target, mode) {
      chmodCalls.push({ target, mode });
    }
  });

  assert.deepEqual(chmodCalls, [{ target: filePath, mode: 0o600 }]);
});

test("credential redaction and project serialization exclude the signing secret", () => {
  const root = projectsRoot();
  const project = tempProject(root, "redaction-project");
  const created = ensureAgentSigningCredential(project);
  const secret = created.credential.signing_secret;
  const manifestText = fs.readFileSync(path.join(project.runtimePath, "factory-project.json"), "utf8");
  const operationFixture = JSON.stringify({
    operation_id: "op-test",
    credential: created.sanitized,
    proof: redactAgentSigningCredential(created.credential)
  });

  assert.equal(manifestText.includes(secret), false);
  assert.equal(JSON.stringify(created.sanitized).includes(secret), false);
  assert.equal(operationFixture.includes(secret), false);
  assert.equal(redactAgentSigningCredential(created.credential).signing_secret, "[redacted]");
});

test("malformed credential record fails safely and is not silently regenerated", () => {
  const root = projectsRoot();
  const project = tempProject(root, "malformed-project");
  const filePath = agentAuthSecretPath(project);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{ broken", "utf8");

  assert.throws(() => readAgentSigningCredential(project), (error) => error.code === "agent_signed_credential_malformed");
  assert.throws(() => ensureAgentSigningCredential(project), (error) => error.code === "agent_signed_credential_malformed");
  assert.throws(() => requireAgentSigningCredential(project), (error) => error.code === "agent_signed_credential_malformed");
});

test("production Launcher callers use the signed Agent client and do not retain operational legacy fallback", () => {
  const files = [
    "src/dependencies.js",
    "src/plan.js",
    "src/generate.js",
    "src/state.js"
  ];

  for (const file of files) {
    const text = readText(file);
    assert.match(text, /fetchJsonWithSignedAuth/);
    assert.doesNotMatch(text, /fetchJsonWithBasicAuth/);
    assert.doesNotMatch(text, /fetchJsonWithCookie/);
    assert.doesNotMatch(text, /loginWithAdminCookie/);
    assert.doesNotMatch(text, /createRestNonce/);
  }

  const installAgent = readText("src/install-agent.js");
  assert.match(installAgent, /\/agent\/auth\/bootstrap/);
  assert.match(installAgent, /fetchJsonWithSignedAuth\(restBase \+ "\/agent\/health"/);
  assert.match(installAgent, /fetchJsonWithSignedAuth\(restBase \+ "\/agent\/capabilities"/);
});

test("operational Agent routes require signed auth and bootstrap remains explicit admin-only", () => {
  const routeFiles = [
    "api/agent-rest.php",
    "api/ai-settings-rest.php",
    "api/ai-live-rest.php",
    "api/ai-interpret-rest.php",
    "api/ai-site-plan-rest.php",
    "api/ai-blueprint-candidate-rest.php",
    "api/ai-preview-diff-rest.php",
    "api/ai-generate-gate-rest.php",
    "api/ai-generate-preflight-rest.php",
    "api/ai-generate-confirmation-rest.php",
    "api/ai-controlled-generate-rest.php"
  ];

  for (const relative of routeFiles) {
    const text = fs.readFileSync(path.resolve(__dirname, "../../wordpress-plugin/includes", relative), "utf8");
    if (relative === "api/agent-rest.php") {
      assert.match(text, /\/agent\/auth\/bootstrap/);
      assert.match(text, /'permission_callback' => 'factory_rest_require_manage_options'/);
      const operational = text.replace(/register_rest_route\(\s*'factory\/v1',\s*'\/agent\/auth\/bootstrap'[\s\S]*?function factory_rest_agent_auth_bootstrap/, "");
      assert.doesNotMatch(operational, /'permission_callback' => 'factory_rest_require_manage_options'/);
      assert.match(operational, /'permission_callback' => 'factory_rest_require_signed_launcher'/);
      continue;
    }
    assert.match(text, /'permission_callback' => 'factory_rest_require_signed_launcher'/);
    assert.doesNotMatch(text, /'permission_callback' => 'factory_rest_require_manage_options'/);
  }
});

test("PHP Agent bootstrap store is idempotent and conflict-safe without returning secrets", () => {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for bootstrap store behavior test");
  const fixture = path.resolve(__dirname, "php-signed-auth-store.php");
  const result = spawnSync(php, [fixture], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.created_code, "agent_auth_bootstrap_created");
  assert.equal(parsed.again_code, "agent_auth_bootstrap_already_configured");
  assert.equal(parsed.different_secret_code, "agent_auth_bootstrap_conflict");
  assert.equal(parsed.different_active_key_code, "agent_auth_bootstrap_conflict");
  assert.equal(parsed.bound_migration_code, "agent_auth_bootstrap_project_bound");
  assert.equal(parsed.bound_again_code, "agent_auth_bootstrap_already_configured");
  assert.equal(parsed.replace_bound_code, "agent_auth_bootstrap_conflict");
  assert.equal(parsed.created_contains_secret, false);
  assert.equal(parsed.again_contains_secret, false);
  assert.equal(parsed.migration_contains_secret, false);
});
