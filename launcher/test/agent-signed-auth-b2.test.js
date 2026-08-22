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
  markAgentSigningCredentialRevoked,
  parseWhoamiCsvSid,
  readAgentSigningCredential,
  redactAgentSigningCredential,
  resolveCurrentWindowsUserSid,
  requireAgentSigningCredential
} = require("../src/agent-credential-store");
const {
  createSigningCredential,
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
const WINDOWS_SYSTEM_SID = "S-1-5-18";
const WINDOWS_ADMINISTRATORS_SID = "S-1-5-32-544";
const WINDOWS_GUESTS_SID = "S-1-5-32-546";
const WINDOWS_ARBITRARY_SID = "S-1-5-21-999999999-888888888-777777777-2002";

function windowsAce(options = {}) {
  return "(" + [
    options.type === undefined ? "A" : options.type,
    options.flags === undefined ? "" : options.flags,
    options.rights === undefined ? "FA" : options.rights,
    options.objectGuid === undefined ? "" : options.objectGuid,
    options.inheritObjectGuid === undefined ? "" : options.inheritObjectGuid,
    options.sid === undefined ? WINDOWS_USER_SID : options.sid
  ].join(";") + ")";
}

function canonicalWindowsSddl(options = {}) {
  const flags = options.directory ? "OICI" : "";
  const system = options.aliases ? "SY" : WINDOWS_SYSTEM_SID;
  const administrators = options.aliases ? "BA" : WINDOWS_ADMINISTRATORS_SID;
  const principals = options.principals || [WINDOWS_USER_SID, system, administrators];
  return "D:PAI" + principals.map((sid) => windowsAce({ flags, sid })).join("");
}

function savedAclRecord(name, sddl) {
  return Buffer.from(String(name || "credential") + "\r\n" + sddl + "\r\n", "utf16le");
}

function windowsAclMock(options = {}) {
  const calls = [];
  let saveIndex = 0;
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
        if (executable === "icacls.exe") {
          if (options.failApply && args.includes(options.failApplyArgument || "/reset")) {
            return { status: 1, stdout: "", stderr: "icacls failed" };
          }
          if (args.includes("/save")) {
            if (options.failSave) {
              return { status: 1, stdout: "", stderr: options.stderr || "icacls save failed" };
            }
            const outputPath = args[args.indexOf("/save") + 1];
            if (!options.missingRecord) {
              const target = args[0];
              const directory = fs.statSync(target).isDirectory();
              const configuredSddl = Array.isArray(options.sddlSequence)
                ? options.sddlSequence[Math.min(saveIndex, options.sddlSequence.length - 1)]
                : options.sddl;
              const sddl = typeof configuredSddl === "function"
                ? configuredSddl({ target, directory, saveIndex })
                : configuredSddl || canonicalWindowsSddl({ directory });
              const content = typeof options.savedContent === "function"
                ? options.savedContent({ target, directory, saveIndex, sddl })
                : options.savedContent || savedAclRecord(path.basename(target), sddl);
              fs.writeFileSync(outputPath, content);
            }
            saveIndex += 1;
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

function assertExactWindowsAcl(summary, directory, currentUserSid = WINDOWS_USER_SID) {
  assert.equal(summary.protected, true);
  assert.equal(summary.dacl_flags, "PAI");
  assert.equal(summary.type, directory ? "directory" : "file");
  assert.equal(summary.access.length, 3);
  assert.deepEqual(
    summary.access.map((entry) => entry.sid).sort(),
    [currentUserSid, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID].sort()
  );
  for (const entry of summary.access) {
    assert.equal(entry.type, "Allow");
    assert.equal(entry.rights, "FullControl");
    assert.equal(entry.inherited, false);
    assert.equal(entry.inheritance_flags, directory ? "OICI" : "");
  }
}

async function rejectWindowsSddl(t, name, sddl, options = {}) {
  await t.test(name, () => {
    const root = projectsRoot();
    try {
      const target = options.directory ? path.join(root, "credential container") : path.join(root, "credential.json");
      if (options.directory) {
        fs.mkdirSync(target, { recursive: true });
      } else {
        fs.writeFileSync(target, "{}\n", "utf8");
      }
      const mock = windowsAclMock({
        sddl,
        savedContent: options.savedContent
      });
      assert.throws(
        () => hardenCredentialPath(target, mock.acl),
        (error) => error.code === "agent_signed_acl_verification_failed"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

function runRealIcacls(args) {
  const result = spawnSync("icacls.exe", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || "icacls failed");
}

function saveRealWindowsAcl(target, proofRoot, label) {
  const savePath = path.join(proofRoot, label + "-acl.txt");
  try {
    runRealIcacls([target, "/save", savePath, "/c"]);
    return fs.readFileSync(savePath).toString("utf16le").replace(/\u0000/g, "").trim();
  } finally {
    fs.rmSync(savePath, { force: true });
  }
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
  const mock = windowsAclMock();
  const created = ensureAgentSigningCredential(project, { acl: mock.acl });
  const icaclsCalls = commandCalls(mock, "icacls.exe");
  const aclSaveCalls = icaclsCalls.filter((call) => call.args.includes("/save"));
  const secret = created.credential.signing_secret;

  assert.equal(created.created, true);
  assert.ok(icaclsCalls.length >= 9);
  assert.ok(aclSaveCalls.length >= 3);
  assert.ok(icaclsCalls.some((call) => call.args.includes("/reset")));
  assert.ok(icaclsCalls.some((call) => call.args.includes("/inheritance:r")));
  assert.ok(icaclsCalls.some((call) => call.args.includes("/grant:r")
    && call.args.includes("*" + WINDOWS_USER_SID + ":(OI)(CI)F")
    && call.args.includes("*S-1-5-18:(OI)(CI)F")
    && call.args.includes("*S-1-5-32-544:(OI)(CI)F")));
  assert.ok(icaclsCalls.some((call) => call.args.includes("/grant:r")
    && call.args.includes("*" + WINDOWS_USER_SID + ":F")
    && call.args.includes("*S-1-5-18:F")
    && call.args.includes("*S-1-5-32-544:F")));
  assert.equal(icaclsCalls.some((call) => call.args.includes("/remove:g")), false);
  assert.equal(mock.calls.some((call) => JSON.stringify(call.args).includes(secret)), false);
  assert.equal(fs.existsSync(created.path), true);
  assert.equal(fs.existsSync(created.path + ".tmp"), false);
});

test("Windows ACL verification transports paths with spaces as fixed icacls arguments", () => {
  const root = projectsRoot();
  const filePath = path.join(root, "credential path with spaces.json");
  fs.writeFileSync(filePath, "{}\n", "utf8");
  const mock = windowsAclMock();

  hardenCredentialPath(filePath, mock.acl);

  const verification = commandCalls(mock, "icacls.exe").find((call) => call.args.includes("/save"));
  assert.equal(verification.args[0], filePath);
  assert.equal(path.dirname(verification.args[verification.args.indexOf("/save") + 1]), path.dirname(filePath));
  assert.equal(fs.existsSync(verification.args[verification.args.indexOf("/save") + 1]), false);
});

test("strict Windows ACL accepts only canonical file, directory, alias, and order variants", async (t) => {
  const positiveCases = [
    { name: "canonical file ACL", directory: false, sddl: canonicalWindowsSddl() },
    { name: "canonical directory ACL", directory: true, sddl: canonicalWindowsSddl({ directory: true }) },
    { name: "SY and BA aliases", directory: false, sddl: canonicalWindowsSddl({ aliases: true }) },
    {
      name: "ACE ordering is immaterial",
      directory: false,
      sddl: canonicalWindowsSddl({ principals: [WINDOWS_ADMINISTRATORS_SID, WINDOWS_USER_SID, WINDOWS_SYSTEM_SID] })
    }
  ];
  for (const entry of positiveCases) {
    await t.test(entry.name, () => {
      const root = projectsRoot();
      try {
        const target = entry.directory ? path.join(root, "credential container") : path.join(root, "credential.json");
        if (entry.directory) {
          fs.mkdirSync(target, { recursive: true });
        } else {
          fs.writeFileSync(target, "{}\n", "utf8");
        }
        const result = hardenCredentialPath(target, windowsAclMock({ sddl: entry.sddl }).acl);
        assertExactWindowsAcl(result, entry.directory);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

test("strict Windows ACL rejects every unauthorized principal independently", async (t) => {
  const required = canonicalWindowsSddl();
  const extra = (sid, rights) => required + windowsAce({ sid, rights });
  const cases = [
    { name: "BUILTIN Guests Read", sddl: extra(WINDOWS_GUESTS_SID, "FR") },
    { name: "BUILTIN Guests Full Control", sddl: extra(WINDOWS_GUESTS_SID, "FA") },
    { name: "arbitrary SID Read", sddl: extra(WINDOWS_ARBITRARY_SID, "FR") },
    { name: "arbitrary SID Full Control", sddl: extra(WINDOWS_ARBITRARY_SID, "FA") },
    { name: "unexpected local or domain principal", sddl: required + windowsAce({ sid: "CONTOSO\\UnexpectedUser" }) },
    { name: "allowed principals plus a fourth principal", sddl: extra("S-1-5-32-545", "FA") }
  ];
  for (const entry of cases) {
    await rejectWindowsSddl(t, entry.name, entry.sddl);
  }
});

test("strict Windows ACL rejects unsupported ACE type, rights, duplication, and inheritance", async (t) => {
  const user = windowsAce({ sid: WINDOWS_USER_SID });
  const system = windowsAce({ sid: WINDOWS_SYSTEM_SID });
  const administrators = windowsAce({ sid: WINDOWS_ADMINISTRATORS_SID });
  const replaceUser = (replacement) => "D:PAI" + replacement + system + administrators;
  const cases = [
    { name: "unknown ACE type", sddl: replaceUser(windowsAce({ type: "ZZ" })) },
    { name: "deny ACE", sddl: replaceUser(windowsAce({ type: "D" })) },
    { name: "audit ACE", sddl: replaceUser(windowsAce({ type: "AU" })) },
    { name: "object-specific ACE", sddl: replaceUser(windowsAce({ type: "OA", objectGuid: "11111111-1111-1111-1111-111111111111" })) },
    { name: "callback ACE", sddl: replaceUser(windowsAce({ type: "XA" })) },
    { name: "duplicate allowed principal", sddl: canonicalWindowsSddl() + user },
    { name: "missing required principal", sddl: "D:PAI" + user + system },
    { name: "partial rights", sddl: replaceUser(windowsAce({ rights: "FR" })) },
    { name: "unsupported compound rights", sddl: replaceUser(windowsAce({ rights: "FAFR" })) },
    { name: "inherited ACE", sddl: replaceUser(windowsAce({ flags: "ID" })) },
    { name: "unexpected inheritance flags", sddl: replaceUser(windowsAce({ flags: "NP" })) },
    { name: "file with directory propagation flags", sddl: replaceUser(windowsAce({ flags: "OICI" })) }
  ];
  for (const entry of cases) {
    await rejectWindowsSddl(t, entry.name, entry.sddl);
  }
  await rejectWindowsSddl(t, "directory without OI and CI", canonicalWindowsSddl(), { directory: true });
  await rejectWindowsSddl(t, "directory with incomplete container inheritance", "D:PAI" +
    windowsAce({ flags: "OI", sid: WINDOWS_USER_SID }) +
    windowsAce({ flags: "OI", sid: WINDOWS_SYSTEM_SID }) +
    windowsAce({ flags: "OI", sid: WINDOWS_ADMINISTRATORS_SID }), { directory: true });
});

test("strict Windows ACL rejects malformed descriptors with complete-consumption checks", async (t) => {
  const canonical = canonicalWindowsSddl();
  const cases = [
    { name: "trailing garbage", sddl: canonical + "garbage" },
    { name: "leading unsupported content", sddl: "O:" + WINDOWS_USER_SID + canonical },
    { name: "unbalanced parentheses", sddl: canonical.slice(0, -1) },
    { name: "incomplete ACE", sddl: "D:PAI(A;;FA;;;" },
    { name: "empty ACE", sddl: "D:PAI()" },
    { name: "extra delimiter fields", sddl: "D:PAI(A;;FA;;;;" + WINDOWS_USER_SID + ")" },
    { name: "missing SID", sddl: "D:PAI(A;;FA;;;)" },
    { name: "missing rights", sddl: "D:PAI(A;;;;;" + WINDOWS_USER_SID + ")" },
    { name: "missing DACL", sddl: "O:" + WINDOWS_USER_SID },
    { name: "missing protection flag", sddl: canonical.replace("D:PAI", "D:AI") },
    { name: "unknown DACL flag", sddl: canonical.replace("D:PAI", "D:PAIZ") },
    { name: "empty DACL", sddl: "D:PAI" },
    { name: "valid prefix followed by malformed suffix", sddl: canonical + "(A;;FA" }
  ];
  for (const entry of cases) {
    await rejectWindowsSddl(t, entry.name, entry.sddl);
  }
  await rejectWindowsSddl(t, "extra leading saved-record line", canonical, {
    savedContent: savedAclRecord("unexpected\r\ncredential", canonical)
  });
  await rejectWindowsSddl(t, "extra trailing saved-record line", canonical, {
    savedContent: Buffer.from(
      savedAclRecord("credential", canonical).toString("utf16le") + "trailing\r\n",
      "utf16le"
    )
  });
});

test("real Windows ACL proof restores exact file and container allowlists", {
  skip: process.platform !== "win32"
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-acl-proof-"));
  console.log("ACL_PROOF_ROOT=" + root);
  try {
    const currentUserSid = resolveCurrentWindowsUserSid({ platform: "win32" });
    const canonicalFile = path.join(root, "canonical file.json");
    console.log("ACL_PROOF_A_FILE=" + canonicalFile);
    fs.writeFileSync(canonicalFile, "{}\n", "utf8");
    assertExactWindowsAcl(hardenCredentialPath(canonicalFile, { platform: "win32" }), false, currentUserSid);
    console.log("ACL_PROOF_A_SAVED=" + JSON.stringify(saveRealWindowsAcl(canonicalFile, root, "canonical-file")));

    const unsafeFile = path.join(root, "unsafe file.json");
    console.log("ACL_PROOF_B_FILE=" + unsafeFile);
    fs.writeFileSync(unsafeFile, "{}\n", "utf8");
    hardenCredentialPath(unsafeFile, { platform: "win32" });
    runRealIcacls([unsafeFile, "/grant", "*" + WINDOWS_GUESTS_SID + ":R"]);
    const unsafeFileBefore = saveRealWindowsAcl(unsafeFile, root, "unsafe-file-before");
    assert.match(unsafeFileBefore, /(?:BG|S-1-5-32-546)/);
    assertExactWindowsAcl(hardenCredentialPath(unsafeFile, { platform: "win32" }), false, currentUserSid);
    const unsafeFileAfter = saveRealWindowsAcl(unsafeFile, root, "unsafe-file-after");
    assert.doesNotMatch(unsafeFileAfter, /(?:BG|S-1-5-32-546)/);
    console.log("ACL_PROOF_B_BEFORE=" + JSON.stringify(unsafeFileBefore));
    console.log("ACL_PROOF_B_AFTER=" + JSON.stringify(unsafeFileAfter));

    const unsafeContainer = path.join(root, "unsafe container");
    console.log("ACL_PROOF_C_CONTAINER=" + unsafeContainer);
    fs.mkdirSync(unsafeContainer);
    hardenCredentialPath(unsafeContainer, { platform: "win32" });
    const protectedChild = path.join(unsafeContainer, "protected child.json");
    fs.writeFileSync(protectedChild, "{}\n", "utf8");
    hardenCredentialPath(protectedChild, { platform: "win32" });
    runRealIcacls([unsafeContainer, "/grant", "*" + WINDOWS_GUESTS_SID + ":(OI)(CI)R"]);
    const unsafeContainerBefore = saveRealWindowsAcl(unsafeContainer, root, "unsafe-container-before");
    assert.match(unsafeContainerBefore, /(?:BG|S-1-5-32-546)/);
    assertExactWindowsAcl(hardenCredentialPath(unsafeContainer, { platform: "win32" }), true, currentUserSid);
    const unsafeContainerAfter = saveRealWindowsAcl(unsafeContainer, root, "unsafe-container-after");
    assert.doesNotMatch(unsafeContainerAfter, /(?:BG|S-1-5-32-546)/);
    console.log("ACL_PROOF_C_BEFORE=" + JSON.stringify(unsafeContainerBefore));
    console.log("ACL_PROOF_C_AFTER=" + JSON.stringify(unsafeContainerAfter));

    const unicodeContainer = path.join(root, "unicode-юнікод-proof");
    console.log("ACL_PROOF_E_CONTAINER=" + unicodeContainer);
    fs.mkdirSync(unicodeContainer);
    assertExactWindowsAcl(hardenCredentialPath(unicodeContainer, { platform: "win32" }), true, currentUserSid);
    const unicodeFile = path.join(unicodeContainer, "облікові-дані.json");
    console.log("ACL_PROOF_E_FILE=" + unicodeFile);
    fs.writeFileSync(unicodeFile, "{}\n", "utf8");
    assertExactWindowsAcl(hardenCredentialPath(unicodeFile, { platform: "win32" }), false, currentUserSid);
    console.log("ACL_PROOF_E_SAVED=" + JSON.stringify(saveRealWindowsAcl(unicodeFile, root, "unicode-file")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    console.log("ACL_PROOF_CLEANED=" + !fs.existsSync(root));
  }
});

test("existing credential load remediates secrets directory and credential ACL", () => {
  const root = projectsRoot();
  const project = tempProject(root, "acl-read-project");
  const created = ensureAgentSigningCredential(project);
  const mock = windowsAclMock();
  const loaded = readAgentSigningCredential(project, { acl: mock.acl });

  assert.equal(loaded.key_id, created.credential.key_id);
  assert.ok(commandCalls(mock, "icacls.exe").some((call) => call.args.includes("/inheritance:r")));
  assert.ok(commandCalls(mock, "icacls.exe").filter((call) => call.args.includes("/save")).length >= 2);
});

test("Windows ACL apply and verification failures fail closed", () => {
  const root = projectsRoot();
  const applyProject = tempProject(root, "acl-apply-fail-project");
  const verifyProject = tempProject(root, "acl-verify-fail-project");
  const applyMock = windowsAclMock({ failApply: true });
  const verifyMock = windowsAclMock({
    sddl: "D:AI" + windowsAce({ flags: "ID", sid: WINDOWS_USER_SID })
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

test("Windows ACL lifecycle and failure propagation remain fail closed", async (t) => {
  await t.test("malformed ACL output produces verification failure", () => {
    const root = projectsRoot();
    try {
      const target = path.join(root, "credential.json");
      fs.writeFileSync(target, "{}\n", "utf8");
      const mock = windowsAclMock({
        savedContent: Buffer.from("credential.json\r\nnot-sddl\r\n", "utf16le")
      });
      assert.throws(
        () => hardenCredentialPath(target, mock.acl),
        (error) => error.code === "agent_signed_acl_verification_failed"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("icacls save nonzero exit produces verification failure", () => {
    const root = projectsRoot();
    try {
      const target = path.join(root, "credential.json");
      fs.writeFileSync(target, "{}\n", "utf8");
      assert.throws(
        () => hardenCredentialPath(target, windowsAclMock({ failSave: true }).acl),
        (error) => error.code === "agent_signed_acl_verification_failed"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("missing saved ACL record produces verification failure", () => {
    const root = projectsRoot();
    try {
      const target = path.join(root, "credential.json");
      fs.writeFileSync(target, "{}\n", "utf8");
      assert.throws(
        () => hardenCredentialPath(target, windowsAclMock({ missingRecord: true }).acl),
        (error) => error.code === "agent_signed_acl_verification_failed"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("successful hardening commands cannot mask unsafe final ACL", () => {
    const root = projectsRoot();
    try {
      const target = path.join(root, "credential.json");
      fs.writeFileSync(target, "{}\n", "utf8");
      const unsafe = canonicalWindowsSddl() + windowsAce({ sid: WINDOWS_GUESTS_SID, rights: "FR" });
      assert.throws(
        () => hardenCredentialPath(target, windowsAclMock({ sddl: unsafe }).acl),
        (error) => error.code === "agent_signed_acl_verification_failed"
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("unsafe container cannot be masked by a protected safe child", () => {
    const root = projectsRoot();
    try {
      const project = tempProject(root, "unsafe-container-project");
      const credentialPath = agentAuthSecretPath(project);
      fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
      fs.writeFileSync(credentialPath, JSON.stringify(createSigningCredential({
        projectSlug: project.project.slug
      }), null, 2) + "\n", "utf8");
      const unsafeContainer = canonicalWindowsSddl({ directory: true }) +
        windowsAce({ flags: "OICI", sid: WINDOWS_GUESTS_SID, rights: "FR" });
      const mock = windowsAclMock({
        sddl({ directory }) {
          return directory ? unsafeContainer : canonicalWindowsSddl();
        }
      });
      assert.throws(
        () => readAgentSigningCredential(project, { acl: mock.acl }),
        (error) => error.code === "agent_signed_acl_verification_failed"
      );
      const saves = commandCalls(mock, "icacls.exe").filter((call) => call.args.includes("/save"));
      assert.equal(saves.length, 1);
      assert.equal(fs.statSync(saves[0].args[0]).isDirectory(), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("credential readiness cannot succeed after ACL verification failure", () => {
    const root = projectsRoot();
    try {
      const project = tempProject(root, "acl-readiness-project");
      const unsafeContainer = canonicalWindowsSddl({ directory: true }) +
        windowsAce({ flags: "OICI", sid: WINDOWS_ARBITRARY_SID, rights: "FA" });
      assert.throws(
        () => ensureAgentSigningCredential(project, { acl: windowsAclMock({ sddl: unsafeContainer }).acl }),
        (error) => error.code === "agent_signed_acl_verification_failed"
      );
      assert.equal(fs.existsSync(agentAuthSecretPath(project)), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test("ACL errors exclude credential content and filesystem paths", () => {
    const root = projectsRoot();
    const secret = "credential-secret-must-not-escape";
    try {
      const target = path.join(root, "credential.json");
      fs.writeFileSync(target, secret, "utf8");
      let captured;
      try {
        hardenCredentialPath(target, windowsAclMock({ failSave: true, stderr: secret + " " + target }).acl);
      } catch (error) {
        captured = error;
      }
      assert.equal(captured.code, "agent_signed_acl_verification_failed");
      assert.equal(captured.message.includes(secret), false);
      assert.equal(captured.message.includes(target), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("non-Windows hardening keeps chmod-based behavior", () => {
  const filePath = path.join(projectsRoot(), "credential.json");
  fs.writeFileSync(filePath, "{}\n", "utf8");
  const chmodCalls = [];
  let hardened = false;

  hardenCredentialPath(filePath, {
    platform: "linux",
    statSync(target) {
      assert.equal(target, filePath);
      return { isDirectory: () => false, mode: hardened ? 0o100600 : 0o100644 };
    },
    chmodSync(target, mode) {
      chmodCalls.push({ target, mode });
      hardened = true;
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

test("explicit local revoke is observable and repair creates a fresh credential", () => {
  const root = projectsRoot();
  const project = tempProject(root, "local-revoke-project");
  const created = ensureAgentSigningCredential(project);
  const revoked = markAgentSigningCredentialRevoked(project, {
    keyId: created.credential.key_id,
    revokedAt: "2026-07-13T01:02:03.000Z"
  });

  assert.equal(revoked.credential.status, "revoked");
  assert.equal(readAgentSigningCredential(project, { allowInactive: true }).status, "revoked");
  assert.throws(
    () => requireAgentSigningCredential(project),
    (error) => error.code === "agent_signed_credential_revoked"
  );

  const repaired = ensureAgentSigningCredential(project, { replaceRevoked: true });
  assert.equal(repaired.created, true);
  assert.notEqual(repaired.credential.key_id, created.credential.key_id);
  assert.equal(repaired.credential.status, "active");
});

test("install repair can upgrade local capability allowlist without replacing key or secret", () => {
  const root = projectsRoot();
  const project = tempProject(root, "local-capability-upgrade-project");
  const limited = ensureAgentSigningCredential(project, {
    capabilities: ["health.read", "capabilities.read"]
  });
  const upgraded = ensureAgentSigningCredential(project, {
    capabilities: ["health.read", "capabilities.read", "auth.rotate", "auth.revoke"],
    upgradeCapabilities: true
  });

  assert.equal(upgraded.created, false);
  assert.equal(upgraded.upgraded, true);
  assert.equal(upgraded.credential.key_id, limited.credential.key_id);
  assert.equal(upgraded.credential.signing_secret, limited.credential.signing_secret);
  assert.deepEqual(upgraded.credential.capabilities, ["health.read", "capabilities.read", "auth.rotate", "auth.revoke"]);
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
  assert.equal(parsed.capabilities_updated_code, "agent_auth_bootstrap_capabilities_updated");
  assert.equal(parsed.bound_migration_code, "agent_auth_bootstrap_project_bound");
  assert.equal(parsed.bound_again_code, "agent_auth_bootstrap_already_configured");
  assert.equal(parsed.replace_bound_code, "agent_auth_bootstrap_conflict");
  assert.equal(parsed.rotation_registered_code, "agent_auth_rotation_registered");
  assert.equal(parsed.rotation_again_code, "agent_auth_rotation_already_registered");
  assert.equal(parsed.rotation_expand_code, "agent_auth_rotation_capability_expansion_denied");
  assert.equal(parsed.rotation_wrong_project_code, "agent_auth_rotation_project_mismatch");
  assert.equal(parsed.rotation_revoke_code, "agent_auth_revoke_completed");
  assert.equal(parsed.rotation_revoke_again_code, "agent_auth_revoke_already_revoked");
  assert.deepEqual(parsed.rotation_active_key_ids, ["rotation-new"]);
  assert.equal(parsed.created_contains_secret, false);
  assert.equal(parsed.again_contains_secret, false);
  assert.equal(parsed.migration_contains_secret, false);
  assert.equal(parsed.rotation_contains_secret, false);
});

test("PHP Agent request limits reject oversized, wrong content type, and excess mutation requests", () => {
  const php = phpBinary();
  assert.ok(php, "PHP binary is required for Agent request limit behavior test");
  const fixture = path.resolve(__dirname, "php-signed-auth-limits.php");
  const result = spawnSync(php, [fixture], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.json_content_type_code, "ok");
  assert.equal(parsed.wrong_content_type_code, "agent_unsupported_media_type");
  assert.equal(parsed.oversized_body_code, "agent_request_body_too_large");
  assert.equal(parsed.rate_limited_code, "agent_rate_limit_exceeded");
  assert.equal(parsed.rate_limited_status, 429);
  assert.equal(parsed.rate_limited_retry_after_present, true);
});
