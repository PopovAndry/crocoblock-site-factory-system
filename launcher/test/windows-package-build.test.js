"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");

const { listDependencyDefinitions } = require("../src/dependency-catalog");
const {
  APPLICATION_EXECUTABLE,
  ARTIFACT_LABEL,
  TAR_MAX_BUFFER,
  TAR_TIMEOUT_MS,
  assertUniqueDestinationPaths,
  buildWindowsLauncherPackage,
  createZipArchive,
  scanPackageArtifact,
  validateBuildFilesystem,
  writeArchiveChecksum
} = require("../../scripts/build-windows-launcher-package");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "factory-package-build-"));
}

function createInstallerTaskRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "csf-phase0-installer-"));
}

function writeFixtureManifest(targetPath, value, useUnicodeEncoding) {
  const content = Buffer.from(JSON.stringify(value), "utf8");
  fs.writeFileSync(targetPath, useUnicodeEncoding ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]) : content);
}

function randomProductName(useUnicode) {
  const suffix = crypto.randomBytes(8).toString("hex");
  return useUnicode ? "CSF Phase0 Поточна папка " + suffix : "CSF Phase0 " + suffix;
}

function rewriteInstallerIdentity(sourcePath, destinationPath, productName, installDirectoryName) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const requiresUnicodeEncoding = /[^\x00-\x7f]/.test(productName);
  const replacements = sourcePath.endsWith("install.cmd")
    ? [
      [
        'set "PRODUCT_NAME=Crocoblock Site Factory"',
        requiresUnicodeEncoding
          ? 'set "PRODUCT_NAME=%CSF_TEST_PRODUCT_NAME%"'
          : 'set "PRODUCT_NAME=' + productName + '"'
      ],
      [
        'set "PRODUCT_DIRECTORY_NAME=Crocoblock Site Factory"',
        requiresUnicodeEncoding
          ? 'set "PRODUCT_DIRECTORY_NAME=%CSF_TEST_INSTALL_DIRECTORY_NAME%"'
          : 'set "PRODUCT_DIRECTORY_NAME=' + installDirectoryName + '"'
      ]
    ]
    : [
      ['$ApplicationName = "Crocoblock Site Factory"', '$ApplicationName = "' + productName + '"'],
      ['$InstallDirectoryName = "Crocoblock Site Factory"', '$InstallDirectoryName = "' + installDirectoryName + '"']
    ];
  let rewritten = source;
  for (const [from, to] of replacements) {
    assert.equal(rewritten.split(from).length - 1, 1, "audited identity substitution: " + from);
    rewritten = rewritten.replace(from, to);
  }
  const content = Buffer.from(rewritten, "utf8");
  if (!sourcePath.endsWith("install.cmd") && requiresUnicodeEncoding) {
    fs.writeFileSync(destinationPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]));
  } else {
    fs.writeFileSync(destinationPath, content);
  }
}

function runTrustedMode(helperPath, mode, environment) {
  return spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", helperPath,
    "-Mode", mode
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
    env: Object.assign({}, process.env, environment || {})
  });
}

function resolveTrustedPaths(helperPath, environment) {
  const result = runTrustedMode(helperPath, "ResolveTrustedPaths", environment);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const values = {};
  for (const line of String(result.stdout || "").trim().split(/\r?\n/)) {
    const separator = line.indexOf("|");
    if (separator > 0) {
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  for (const key of ["LOCAL", "ROAMING", "DOCUMENTS"]) {
    assert.equal(typeof values[key], "string", key);
    assert.notEqual(values[key], "", key);
  }
  return values;
}

function assertSanitizedResolverFailure(result, layout, environment) {
  const combined = [result.stdout, result.stderr, result.record && JSON.stringify(result.record)].filter(Boolean).join("\n");
  for (const sensitive of [
    layout.root,
    layout.helperPath,
    layout.installPath,
    environment.LOCALAPPDATA,
    environment.APPDATA,
    environment.USERPROFILE,
    environment.FACTORY_UNINSTALL_ROOT
  ]) {
    assert.equal(combined.includes(sensitive), false, "sanitized output omits " + sensitive);
  }
  assert.doesNotMatch(combined, /\.ps1(?:\s|:)|line\s+\d+|At\s+.*\.ps1|CategoryInfo|FullyQualifiedErrorId|ScriptStackTrace|0x[0-9a-f]+|known_folder_unavailable/i);
}

function resolveKnownFolderPathsWithFlags(root) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class CsfPhase0KnownFolderProbe {',
    '  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]',
    '  public static extern int SHGetKnownFolderPath(ref Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);',
    '}',
    '\'@',
    'function Resolve-KnownFolderPath {',
    '  param([guid]$KnownFolderId, [uint32]$Flags)',
    '  $allocated = [IntPtr]::Zero',
    '  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '  try {',
    '    $status = [CsfPhase0KnownFolderProbe]::SHGetKnownFolderPath([ref]$KnownFolderId, $Flags, $identity.Token, [ref]$allocated)',
    '  } finally {',
    '    $identity.Dispose()',
    '  }',
    '  if ($status -ne 0 -or $allocated -eq [IntPtr]::Zero) { throw "known_folder_probe_failed" }',
    '  try { return [Runtime.InteropServices.Marshal]::PtrToStringUni($allocated) } finally { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($allocated) }',
    '}',
    '$folders = [ordered]@{ LOCAL = [guid]"F1B32785-6FBA-4FCF-9D55-7B8E7F157091"; ROAMING = [guid]"3EB685DB-65F9-4CF6-A03A-E3EF65729F3D"; DOCUMENTS = [guid]"FDD39AD0-238F-46AF-ADB4-6C85480369C7" }',
    'foreach ($entry in $folders.GetEnumerator()) {',
    '  Write-Output ($entry.Key + "|CURRENT|" + (Resolve-KnownFolderPath $entry.Value 0))',
    '  Write-Output ($entry.Key + "|DEFAULT|" + (Resolve-KnownFolderPath $entry.Value 0x00000400))',
    '}',
    'exit 0'
  ].join("\n");
  const probePath = path.join(root, "known-folder-probe.ps1");
  fs.writeFileSync(probePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(script, "utf8")]));
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", probePath
  ], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const values = {};
  for (const line of String(result.stdout || "").trim().split(/\r?\n/)) {
    const [folder, policy, ...pathParts] = line.split("|");
    if (folder && policy && pathParts.length > 0) {
      values[folder] = values[folder] || {};
      values[folder][policy] = pathParts.join("|");
    }
  }
  for (const folder of ["LOCAL", "ROAMING", "DOCUMENTS"]) {
    assert.equal(typeof values[folder]?.CURRENT, "string", folder + " current");
    assert.equal(typeof values[folder]?.DEFAULT, "string", folder + " default");
  }
  return values;
}

function replaceFolderIdWithFailureFixture(scriptPath) {
  const source = fs.readFileSync(scriptPath, "utf8");
  const original = '$KnownFolderRoamingAppData = [guid]"3EB685DB-65F9-4CF6-A03A-E3EF65729F3D"';
  const replacement = '$KnownFolderRoamingAppData = [guid]"00000000-0000-0000-0000-000000000000"';
  assert.equal(source.split(original).length - 1, 1, "bounded Known Folder failure substitution");
  fs.writeFileSync(scriptPath, source.replace(original, replacement), "utf8");
}

function replaceResolverResponseFixture(scriptPath, records, exitCode) {
  const source = fs.readFileSync(scriptPath, "utf8");
  const marker = '$ProgressPreference = "SilentlyContinue"';
  const fixture = [
    marker,
    '',
    'if ($Mode -eq "ResolveAndValidateInstallPaths") {',
    ...records.map((record) => '  [Console]::Out.WriteLine(' + JSON.stringify(record) + ')'),
    '  exit ' + exitCode,
    '}'
  ].join("\n");
  assert.equal(source.split(marker).length - 1, 1, "bounded resolver fixture insertion");
  fs.writeFileSync(scriptPath, source.replace(marker, fixture), "utf8");
}

function replaceAuthoritativeSnapshotFixture(scriptPath) {
  const source = fs.readFileSync(scriptPath, "utf8");
  const marker = 'if ($Mode -ne "Cleanup") {';
  const fixture = [
    'if (-not [string]::IsNullOrWhiteSpace($env:CSF_TEST_SNAPSHOT_LOG)) {',
    '  [IO.File]::AppendAllText($env:CSF_TEST_SNAPSHOT_LOG, "MODE|$Mode`n")',
    '}',
    'function Get-TrustedLayout {',
    '  if (-not [string]::IsNullOrWhiteSpace($env:CSF_TEST_SNAPSHOT_LOG)) {',
    '    [IO.File]::AppendAllText($env:CSF_TEST_SNAPSHOT_LOG, "LAYOUT|$Mode`n")',
    '  }',
    '  if ($Mode -eq "ValidateInstallPaths") {',
    '    $localAppData = $env:CSF_TEST_SNAPSHOT_B_LOCAL',
    '    $roamingAppData = $env:CSF_TEST_SNAPSHOT_B_ROAMING',
    '    $documents = $env:CSF_TEST_SNAPSHOT_B_DOCUMENTS',
    '  } else {',
    '    $localAppData = $env:CSF_TEST_SNAPSHOT_A_LOCAL',
    '    $roamingAppData = $env:CSF_TEST_SNAPSHOT_A_ROAMING',
    '    $documents = $env:CSF_TEST_SNAPSHOT_A_DOCUMENTS',
    '  }',
    '  $installParent = Join-Path $localAppData "Programs"',
    '  $installRoot = Join-Path $installParent $InstallDirectoryName',
    '  $shortcutDirectory = Join-Path $roamingAppData "Microsoft\\Windows\\Start Menu\\Programs\\$ApplicationName"',
    '  [ordered]@{',
    '    local_app_data = $localAppData',
    '    roaming_app_data = $roamingAppData',
    '    documents = $documents',
    '    install_parent = $installParent',
    '    install_root = $installRoot',
    '    shortcut_directory = $shortcutDirectory',
    '    shortcut_path = Join-Path $shortcutDirectory "$ApplicationName.lnk"',
    '  }',
    '}',
    marker
  ].join("\n");
  assert.equal(source.split(marker).length - 1, 1, "bounded authoritative snapshot fixture insertion");
  fs.writeFileSync(scriptPath, source.replace(marker, fixture), "utf8");
}

function replaceResolverTransportFixture(installPath, replacement) {
  const source = fs.readFileSync(installPath, "utf8");
  const marker = "[Console]::Out.WriteLine('RESOLVER_EXIT|' + $process.ExitCode)";
  assert.equal(source.split(marker).length - 1, 1, "bounded resolver transport substitution");
  fs.writeFileSync(installPath, source.replace(marker, replacement), "utf8");
}

function resolverRecords(layout, options) {
  const values = Object.assign({
    LOCAL: layout.trusted.LOCAL,
    ROAMING: layout.trusted.ROAMING,
    DOCUMENTS: layout.trusted.DOCUMENTS
  }, options || {});
  return Object.entries(values).map(([name, value]) => name + "|" + value);
}

function assertResolverBoundaryRejected(result, layout) {
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /Windows known folders could not be resolved\./i);
  assert.doesNotMatch(result.stdout, /package files are missing/i);
  assert.equal(String(result.stderr || "").trim(), "");
  assert.equal(fs.existsSync(layout.installRoot), false);
  assert.equal(fs.existsSync(layout.shortcutPath), false);
}

function createResolverRejectionSentinels(layout) {
  const sentinels = [
    [layout.dataRoot, "explicit data sentinel\n"],
    [layout.projectRoot, "explicit projects sentinel\n"],
    [path.join(layout.root, "external unrelated target"), "external sentinel\n"]
  ].map(([directory, contents]) => {
    fs.mkdirSync(directory, { recursive: true });
    const marker = path.join(directory, "preserved.txt");
    fs.writeFileSync(marker, contents, "utf8");
    return { directory, marker, contents };
  });
  return sentinels;
}

function assertResolverRejectionSentinels(sentinels) {
  for (const sentinel of sentinels) {
    assert.equal(fs.existsSync(sentinel.directory), true, sentinel.directory);
    assert.equal(fs.readFileSync(sentinel.marker, "utf8"), sentinel.contents, sentinel.marker);
  }
}

function createTrustedInstallerFixture(options) {
  const root = createInstallerTaskRoot();
  const productName = randomProductName(options && options.unicodeProduct);
  const installDirectoryName = options && options.nestedInstallDirectory
    ? "CSF Phase0 Parent " + crypto.randomBytes(6).toString("hex") + "\\" + productName
    : productName;
  const packageRoot = path.join(root, "package with spaces");
  const installerDirectory = path.join(packageRoot, "installer");
  const helperDirectory = path.join(root, "external cleanup helper");
  fs.mkdirSync(installerDirectory, { recursive: true });
  fs.mkdirSync(helperDirectory, { recursive: true });
  rewriteInstallerIdentity(
    path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "install.cmd"),
    path.join(installerDirectory, "install.cmd"),
    productName,
    installDirectoryName
  );
  rewriteInstallerIdentity(
    path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "uninstall-cleanup.ps1"),
    path.join(installerDirectory, "uninstall-cleanup.ps1"),
    productName,
    installDirectoryName
  );
  const helperPath = path.join(helperDirectory, "uninstall-cleanup.ps1");
  rewriteInstallerIdentity(
    path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "uninstall-cleanup.ps1"),
    helperPath,
    productName,
    installDirectoryName
  );
  fs.copyFileSync(path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "launch.vbs"), path.join(installerDirectory, "launch.vbs"));
  assert.equal(fs.existsSync(process.execPath), true, "Node executable is required for the Windows installer proof");
  fs.copyFileSync(process.execPath, path.join(packageRoot, productName + ".exe"));
  fs.mkdirSync(path.join(packageRoot, "app", "launcher", "src"), { recursive: true });
  fs.mkdirSync(path.join(packageRoot, "resources"), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "app", "launcher", "src", "windows-package-main.js"), "process.exit(0);\n", "utf8");
  writeFixtureManifest(path.join(packageRoot, "resources", "package-manifest.json"), {
    application_name: productName,
    architecture: "x64",
    artifact_label: "INTERNAL EVALUATION BUILD"
  }, options && options.unicodeProduct);

  const trusted = resolveTrustedPaths(helperPath);
  const installRoot = path.join(trusted.LOCAL, "Programs", ...installDirectoryName.split("\\"));
  const installParent = path.dirname(installRoot);
  const shortcutDirectory = path.join(trusted.ROAMING, "Microsoft", "Windows", "Start Menu", "Programs", productName);
  const shortcutPath = path.join(shortcutDirectory, productName + ".lnk");
  const dataRoot = path.join(root, "data root");
  const projectRoot = path.join(root, "projects root");
  const spoofRoot = path.join(root, "attacker controlled root");
  const spoofShortcutDirectory = path.join(root, "attacker start menu", productName);
  assert.equal(fs.existsSync(installRoot), false, "randomized install root must not pre-exist");
  assert.equal(fs.existsSync(shortcutDirectory), false, "randomized shortcut root must not pre-exist");

  return {
    root,
    productName,
    installDirectoryName,
    usesUnicodeIdentity: Boolean(options && options.unicodeProduct),
    testIdentityEnvironment: options && options.unicodeProduct ? {
      CSF_TEST_PRODUCT_NAME: productName,
      CSF_TEST_INSTALL_DIRECTORY_NAME: installDirectoryName
    } : {},
    packageRoot,
    installPath: path.join(installerDirectory, "install.cmd"),
    installerHelperPath: path.join(installerDirectory, "uninstall-cleanup.ps1"),
    helperPath,
    trusted,
    installParent,
    installRoot,
    shortcutDirectory,
    shortcutPath,
    dataRoot,
    projectRoot,
    spoofRoot,
    spoofShortcutDirectory
  };
}

function createValidTrustedInstallation(layout) {
  for (const directory of [
    path.join(layout.installRoot, "app"),
    path.join(layout.installRoot, "installer"),
    path.join(layout.installRoot, "resources"),
    layout.dataRoot,
    layout.projectRoot
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(layout.installRoot, layout.productName + ".exe"), "placeholder executable", "utf8");
  fs.writeFileSync(path.join(layout.installRoot, "installer", ".factory-install-root"), "owned\n", "utf8");
  writeFixtureManifest(path.join(layout.installRoot, "resources", "package-manifest.json"), {
    application_name: layout.productName,
    architecture: "x64",
    artifact_label: "INTERNAL EVALUATION BUILD"
  }, layout.usesUnicodeIdentity);
  fs.writeFileSync(path.join(layout.dataRoot, "preserved.txt"), "application data\n", "utf8");
  fs.writeFileSync(path.join(layout.projectRoot, "preserved.txt"), "project data\n", "utf8");
}

function attackerEnvironment(layout) {
  return {
    LOCALAPPDATA: path.join(layout.spoofRoot, "Local AppData"),
    APPDATA: path.join(layout.spoofRoot, "Roaming AppData"),
    USERPROFILE: path.join(layout.spoofRoot, "User Profile"),
    FACTORY_UNINSTALL_ROOT: path.join(layout.spoofRoot, "Copied Identity"),
    FACTORY_UNINSTALL_TIMEOUT_SECONDS: "1"
  };
}

function runInstall(layout, environment) {
  return spawnSync("cmd.exe", [
    "/d",
    "/c",
    "call",
    layout.installPath,
    "--data-root", layout.dataRoot,
    "--projects-root", layout.projectRoot
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    env: Object.assign({}, process.env, layout.testIdentityEnvironment, environment || {})
  });
}

function runCleanupHelper(layout, environment) {
  const helperPath = environment && environment.helperPath ? environment.helperPath : layout.helperPath;
  const childEnvironment = environment && environment.values ? environment.values : environment;
  const result = runTrustedMode(helperPath, "Cleanup", Object.assign({}, layout.testIdentityEnvironment, childEnvironment || {}));
  const resultPath = path.join(path.dirname(helperPath), "uninstall-result.json");
  return {
    process: result,
    record: fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")) : null
  };
}

function unlinkDirectoryLink(linkPath) {
  if (fs.lstatSync(linkPath).isSymbolicLink()) {
    fs.unlinkSync(linkPath);
  }
}

function cleanupTrustedFixture(layout) {
  for (const target of [layout.shortcutPath, layout.shortcutDirectory, layout.installRoot]) {
    if (!fs.existsSync(target)) {
      continue;
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(target);
    } else {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  const installLeafParent = path.dirname(layout.installRoot);
  if (installLeafParent !== path.join(layout.trusted.LOCAL, "Programs") && fs.existsSync(installLeafParent)) {
    fs.rmdirSync(installLeafParent);
  }
  fs.rmSync(layout.root, { recursive: true, force: true });
}

function emitTrustedProof(name, layout, details) {
  process.stdout.write("INSTALLER_TRUSTED_PROOF=" + JSON.stringify(Object.assign({
    name,
    install_root: layout.installRoot,
    shortcut_path: layout.shortcutPath,
    authority: "known_folder_current_path"
  }, details)) + "\n");
}

function createApprovedVendorBundle(root) {
  const vendorDirectory = path.join(root, "vendor-inputs");
  fs.mkdirSync(vendorDirectory, { recursive: true });
  for (const dependency of listDependencyDefinitions()) {
    const staging = path.join(root, "staging-" + dependency.slug);
    const identityPath = path.join(staging, dependency.identity_file);
    fs.mkdirSync(path.dirname(identityPath), { recursive: true });
    fs.writeFileSync(identityPath, dependency.type === "theme"
      ? "/*\nTheme Name: Test\nVersion: 1.2.3\n*/\n"
      : "<?php\n/*\nPlugin Name: Test\nVersion: 1.2.3\n*/\n", "utf8");
    const archivePath = path.join(vendorDirectory, dependency.slug + ".zip");
    const archived = spawnSync("tar", ["-a", "-c", "-f", archivePath, "-C", staging, dependency.zip_root], { encoding: "utf8", windowsHide: true });
    assert.equal(archived.status, 0, archived.stderr || "test ZIP creation failed");
  }
  return vendorDirectory;
}

function createBuildFixture(root) {
  const repositoryRoot = path.join(root, "repository");
  const launcherRoot = path.join(repositoryRoot, "launcher");
  fs.mkdirSync(launcherRoot, { recursive: true });
  for (const relativePath of ["src", "contracts", "windows-installer", "package.json"]) {
    fs.cpSync(path.join(REPOSITORY_ROOT, "launcher", relativePath), path.join(launcherRoot, relativePath), { recursive: true, force: true });
  }
  fs.cpSync(path.join(REPOSITORY_ROOT, "wordpress-plugin"), path.join(repositoryRoot, "wordpress-plugin"), { recursive: true });
  const nodeExecutable = path.join(root, "node.exe");
  fs.writeFileSync(nodeExecutable, "synthetic node", "utf8");
  return {
    repositoryRoot,
    nodeExecutable,
    vendorDirectory: createApprovedVendorBundle(root),
    outputRoot: path.join(root, "output")
  };
}

function buildFixtureOptions(fixture, outputRoot) {
  return {
    repositoryRoot: fixture.repositoryRoot,
    outputRoot: outputRoot || fixture.outputRoot,
    nodeExecutable: fixture.nodeExecutable,
    vendorDirectory: fixture.vendorDirectory
  };
}

test("Windows internal evaluation package closes the current Create Website runtime and resource manifest", () => {
  const root = createTempRoot();
  const fakeNode = path.join(root, "node.exe");
  fs.writeFileSync(fakeNode, "packaged-node-runtime", "utf8");
  const vendorDirectory = createApprovedVendorBundle(root);
  const archiveDirectory = path.join(vendorDirectory, "archive", "jetformbuilder");
  fs.mkdirSync(archiveDirectory, { recursive: true });
  fs.copyFileSync(
    path.join(vendorDirectory, "jet-form-builder.zip"),
    path.join(archiveDirectory, "jetformbuilder.3.6.5.1.zip")
  );
  const result = buildWindowsLauncherPackage({
    repositoryRoot: REPOSITORY_ROOT,
    outputRoot: path.join(root, "output"),
    nodeExecutable: fakeNode,
    vendorDirectory
  });

  const requiredFiles = [
    APPLICATION_EXECUTABLE,
    "Launch Crocoblock Site Factory.vbs",
    "app/launcher/package.json",
    "app/launcher/src/windows-package-main.js",
    "app/launcher/src/windows-package-runtime.js",
    "app/launcher/src/platform-runtime.js",
    "app/launcher/src/system-check.js",
    "app/launcher/src/server.js",
    "app/launcher/src/create-website.js",
    "app/launcher/src/ui/create-website-ui.js",
    "app/launcher/src/ui/app.js",
    "app/launcher/src/ui/styles.css",
    "app/launcher/src/project-store.js",
    "app/launcher/src/project-operation-coordinator.js",
    "app/launcher/src/dependency-sources.js",
    "app/launcher/src/managed-package-cache.js",
    "app/launcher/src/package-validator.js",
    "app/launcher/src/install-agent.js",
    "app/launcher/src/real-estate-contract.js",
    "app/launcher/contracts/real-estate-contract.v1.json",
    "app/wordpress-plugin/crocoblock-site-factory.php",
    "app/wordpress-plugin/presets/real-estate.json",
    "installer/install.cmd",
    "installer/uninstall.cmd",
    "installer/uninstall-cleanup.ps1",
    "resources/package-manifest.json",
    "resources/managed-packages/kava.zip",
    "resources/managed-packages/jet-engine.zip",
    "resources/managed-packages/jet-smart-filters.zip",
    "resources/managed-packages/jet-form-builder.zip"
  ];
  for (const relativePath of requiredFiles) {
    assert.equal(fs.existsSync(path.join(result.packageRoot, ...relativePath.split("/"))), true, relativePath);
  }
  assert.equal(fs.existsSync(path.join(result.packageRoot, "app", "launcher", "src", "cli.js")), false);
  assert.equal(result.manifest.artifact_label, ARTIFACT_LABEL);
  assert.equal(result.manifest.application_name, "Crocoblock Site Factory");
  assert.equal(result.manifest.application_version, require("../package.json").version);
  assert.equal(result.manifest.architecture, "x64");
  assert.equal(result.manifest.signed, false);
  assert.equal(result.manifest.public_release_ready, false);
  assert.equal(result.manifest.rehearsal.frozen_project_slug, "win-ceo-rehearsal-smoke-3");
  assert.equal(result.manifest.managed_packages.length, 4);
  assert.deepEqual(result.manifest.managed_packages.map((entry) => entry.key), ["kava", "jet-engine", "jet-smart-filters", "jet-form-builder"]);
  assert.equal(result.manifest.managed_packages.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)), true);
  assert.equal(result.inventory.some((entry) => entry.includes("archive/")), false);
  assert.equal(result.inventory.some((entry) => /(?:^|\/)test(?:s)?\//i.test(entry)), false);
  assert.equal(result.inventory.filter((entry) => entry === "installer/uninstall-cleanup.ps1").length, 1);
  assert.doesNotThrow(() => scanPackageArtifact(result.packageRoot));

  const archivePath = createZipArchive(result.packageRoot, path.join(root, result.identity.archiveName));
  const checksum = writeArchiveChecksum(archivePath);
  assert.equal(fs.existsSync(archivePath), true);
  assert.equal(fs.existsSync(checksum.checksumPath), true);
  assert.match(checksum.digest, /^[a-f0-9]{64}$/);
});

test("Windows package build rejects missing or invalid JetFormBuilder inputs", () => {
  const root = createTempRoot();
  const missing = createBuildFixture(root);
  fs.unlinkSync(path.join(missing.vendorDirectory, "jet-form-builder.zip"));
  assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(missing)), /Windows package build filesystem layout is invalid/);
  assert.equal(fs.existsSync(missing.outputRoot), false);

  const invalidRoot = createTempRoot();
  const invalid = createBuildFixture(invalidRoot);
  fs.writeFileSync(path.join(invalid.vendorDirectory, "jet-form-builder.zip"), "not a zip", "utf8");
  assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(invalid)), /central directory not found/);
});

test("package scan rejects developer paths, credentials, and prior runtime state", () => {
  const root = createTempRoot();
  fs.writeFileSync(path.join(root, "bad.json"), JSON.stringify({ root: "C:\\sf-vendor\\kava.zip" }), "utf8");
  assert.throws(() => scanPackageArtifact(root), /developer-specific absolute path/);
  fs.rmSync(path.join(root, "bad.json"));
  fs.writeFileSync(path.join(root, ".env"), "WP_ADMIN_PASSWORD=not-a-real-password\n", "utf8");
  assert.throws(() => scanPackageArtifact(root), /blocked runtime or credential file/);
  fs.rmSync(path.join(root, ".env"));
  fs.mkdirSync(path.join(root, "proofs"));
  assert.throws(() => scanPackageArtifact(root), /runtime-state directory/);
});

test("proprietary dependency archives are not tracked by Git", () => {
  const result = spawnSync("git", ["ls-files", "*.zip"], { cwd: REPOSITORY_ROOT, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0);
  assert.equal(String(result.stdout || "").trim(), "");
});

test("builder rejects source/output aliasing and source reparse entries before output mutation", (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createBuildFixture(root);
  const aliases = [
    path.join(fixture.repositoryRoot, "launcher", "src"),
    path.join(fixture.repositoryRoot, "launcher", "src", "inside-output"),
    fixture.repositoryRoot
  ];
  for (const outputRoot of aliases) {
    assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(fixture, outputRoot)), /filesystem layout is invalid/);
  }
  const outside = path.join(root, "outside-target");
  const linkedEntry = path.join(fixture.repositoryRoot, "launcher", "src", "linked-source");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "preserved.txt"), "outside\n", "utf8");
  try {
    fs.symlinkSync(outside, linkedEntry, "junction");
  } catch (error) {
    try {
      fs.symlinkSync(outside, linkedEntry, "dir");
    } catch (linkError) {
      t.skip("Local symlink and junction creation are unavailable on this host.");
      return;
    }
  }
  assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(fixture)), /filesystem layout is invalid/);
  assert.equal(fs.existsSync(fixture.outputRoot), false);
  assert.equal(fs.existsSync(path.join(outside, "preserved.txt")), true);
});

test("builder rejects output junction aliases and Windows case aliases before output mutation", (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = createBuildFixture(root);
  const alias = path.join(root, "output-alias");
  try {
    fs.symlinkSync(path.join(fixture.repositoryRoot, "launcher", "src"), alias, "junction");
  } catch (error) {
    try {
      fs.symlinkSync(path.join(fixture.repositoryRoot, "launcher", "src"), alias, "dir");
    } catch (linkError) {
      t.skip("Local symlink and junction creation are unavailable on this host.");
      return;
    }
  }
  assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(fixture, alias)), /filesystem layout is invalid/);
  assert.equal(fs.existsSync(path.join(alias, "Crocoblock-Site-Factory-Windows-x64-0.1.0-beta")), false);
  if (process.platform === "win32") {
    const caseAlias = path.join(fixture.repositoryRoot, "LAUNCHER", "SRC");
    assert.throws(() => buildWindowsLauncherPackage(buildFixtureOptions(fixture, caseAlias)), /filesystem layout is invalid/);
  }
});

test("builder rejects duplicate and case-colliding package destinations", () => {
  assert.throws(() => assertUniqueDestinationPaths(["app/launcher/src/index.js", "app/launcher/src/index.js"]), /filesystem layout is invalid/);
  if (process.platform === "win32") {
    assert.throws(() => assertUniqueDestinationPaths(["app/Launcher/src/index.js", "app/launcher/src/index.js"]), /filesystem layout is invalid/);
  }
  const root = createTempRoot();
  const fixture = createBuildFixture(root);
  assert.doesNotThrow(() => validateBuildFilesystem(buildFixtureOptions(fixture)));
  fs.rmSync(root, { recursive: true, force: true });
});

test("archive creation has a fixed bounded process boundary and removes only its partial archive", () => {
  const root = createTempRoot();
  const packageRoot = path.join(root, "package");
  const archivePath = path.join(root, "archive.zip");
  const unrelatedPath = path.join(root, "unrelated.txt");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(unrelatedPath, "preserve\n", "utf8");
  const cases = [
    { name: "nonzero", result: { status: 1 } },
    { name: "timeout", result: { status: null, error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) } },
    { name: "oversized output", result: { status: null, error: Object.assign(new Error("buffer"), { code: "ENOBUFS" }), stdout: "x".repeat(TAR_MAX_BUFFER + 1) } },
    { name: "signal", result: { status: null, signal: "SIGTERM" } }
  ];
  for (const entry of cases) {
    let invocation;
    assert.throws(() => createZipArchive(packageRoot, archivePath, {
      spawnSync(command, args, options) {
        invocation = { command, args, options };
        fs.writeFileSync(archivePath, "partial\n", "utf8");
        return entry.result;
      }
    }), /archive could not be created/);
    assert.equal(invocation.command, "tar", entry.name);
    assert.equal(invocation.options.shell, false, entry.name);
    assert.equal(invocation.options.timeout, TAR_TIMEOUT_MS, entry.name);
    assert.equal(invocation.options.maxBuffer, TAR_MAX_BUFFER, entry.name);
    assert.equal(fs.existsSync(archivePath), false, entry.name);
    assert.equal(fs.existsSync(unrelatedPath), true, entry.name);
  }
  assert.throws(() => createZipArchive(packageRoot, archivePath, {
    spawnSync() { throw new Error("unavailable"); }
  }), /archive could not be created/);
  assert.equal(fs.existsSync(archivePath), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("uninstaller removes only application files and explicitly preserves data and projects", () => {
  const installPath = path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "install.cmd");
  const uninstallPath = path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "uninstall.cmd");
  const cleanupPath = path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "uninstall-cleanup.ps1");
  const install = fs.readFileSync(installPath, "utf8");
  const uninstall = fs.readFileSync(uninstallPath, "utf8");
  const cleanup = fs.readFileSync(cleanupPath, "utf8");
  assert.match(install, /set "PRODUCT_NAME=Crocoblock Site Factory"/i);
  assert.match(install, /ResolveAndValidateInstallPaths/i);
  assert.doesNotMatch(install, /-Mode ValidateInstallPaths/i);
  assert.match(install, /CreateShortcut/i);
  assert.doesNotMatch(install, /%LOCALAPPDATA%|%APPDATA%|%USERPROFILE%/i);
  assert.doesNotMatch(install, /--install-root/i);
  assert.match(install, /if "%~2"=="" \(/i);
  assert.match(install, /installation root must be empty or owned/i);
  assert.match(install, /> "%INSTALL_ROOT%\\installer\\\.factory-install-root"/i);
  assert.doesNotMatch(install, /FACTORY_SHORTCUT_DIR|FACTORY_INSTALL_ROOT/i);
  assert.match(uninstall, /set "INSTALL_ROOT=%%~fI"/i);
  assert.match(uninstall, /if not defined INSTALL_ROOT/i);
  assert.match(uninstall, /if \/I "%INSTALL_ROOT%"=="%INSTALL_DRIVE_ROOT%"/i);
  assert.match(uninstall, /if not exist "%INSTALL_ROOT%\\installer\\\.factory-install-root"/i);
  assert.match(uninstall, /if not exist "%INSTALL_ROOT%\\Crocoblock Site Factory\.exe"/i);
  assert.match(uninstall, /if not exist "%INSTALL_ROOT%\\resources\\package-manifest\.json"/i);
  assert.match(uninstall, /if not exist "%INSTALL_ROOT%\\installer\\uninstall-cleanup\.ps1"/i);
  assert.match(uninstall, /copy \/y "%INSTALL_ROOT%\\installer\\uninstall-cleanup\.ps1"/i);
  assert.match(uninstall, /set "FACTORY_UNINSTALL_ROOT=%INSTALL_ROOT%"/i);
  assert.match(uninstall, /cd \/d "%SystemRoot%"/i);
  assert.match(uninstall, /start "" \/b powershell\.exe .* -File "%CLEANUP_SCRIPT%"/i);
  assert.doesNotMatch(uninstall, /rmdir \/s|Remove-Item|del \/s/i);
  assert.doesNotMatch(uninstall, /application files were removed/i);
  assert.match(uninstall, /external cleanup will report the verified result/i);
  assert.match(cleanup, /SHGetKnownFolderPath/i);
  assert.match(cleanup, /Get-TrustedKnownFolderPath/i);
  assert.match(cleanup, /Assert-NormalDirectoryChain/i);
  assert.match(cleanup, /package-manifest\.json/i);
  assert.match(cleanup, /INTERNAL EVALUATION BUILD/i);
  assert.match(cleanup, /Assert-NoReparsePoints/i);
  assert.match(cleanup, /\[IO\.Directory\]::Delete\(\$installRoot, \$true\)/i);
  assert.doesNotMatch(cleanup, /Remove-Item\s+-Recurse|rmdir\s+\/s|del\s+\/s/i);
  assert.doesNotMatch(cleanup, /FACTORY_UNINSTALL_ROOT|\$env:LOCALAPPDATA|\$env:APPDATA|\$env:USERPROFILE/i);
  assert.match(cleanup, /shortcut_cleanup_failed/i);
  assert.match(cleanup, /Write-CleanupResult "succeeded"/i);
});

test("installer rejects malformed and unsupported root arguments before filesystem mutation", (t) => {
  const root = createTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installPath = path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "install.cmd");
  const cases = [
    { name: "direct custom install root", args: (paths) => ["--install-root", paths.customRoot] },
    { name: "empty positional before install root", args: (paths) => ["", "--install-root", paths.customRoot] },
    { name: "install root as projects value", args: () => ["--projects-root", "--install-root"] },
    { name: "install root as data value", args: () => ["--data-root", "--install-root"] },
    { name: "data option as projects value", args: (paths) => ["--projects-root", "--data-root", paths.dataRoot] },
    { name: "projects option as data value", args: (paths) => ["--data-root", "--projects-root", paths.projectsRoot] },
    { name: "slash option as projects value", args: () => ["--projects-root", "/install-root"] },
    { name: "missing projects value", args: () => ["--projects-root"] },
    { name: "missing data value", args: () => ["--data-root"] },
    { name: "empty projects value", args: () => ["--projects-root", ""] },
    { name: "empty data value", args: () => ["--data-root", ""] },
    { name: "install root after supported option", args: (paths) => ["--projects-root", paths.projectsRoot, "--install-root", paths.customRoot] },
    { name: "duplicated install root", args: (paths) => ["--install-root", paths.customRoot, "--install-root", paths.secondCustomRoot] },
    { name: "install root equals form", args: (paths) => ["--install-root=" + paths.customRoot] },
    { name: "supported option equals form", args: (paths) => ["--data-root=" + paths.dataRoot] },
    { name: "duplicate projects root", args: (paths) => ["--projects-root", paths.projectsRoot, "--projects-root", paths.customRoot] },
    { name: "duplicate data root", args: (paths) => ["--data-root", paths.dataRoot, "--data-root", paths.customRoot] },
    { name: "unknown argument", args: () => ["--unknown-root"] }
  ];

  for (const [index, entry] of cases.entries()) {
    const caseRoot = path.join(root, "case-" + String(index).padStart(2, "0"));
    const paths = {
      localAppData: path.join(caseRoot, "Local App Data"),
      userProfile: path.join(caseRoot, "User Profile"),
      customRoot: path.join(caseRoot, "Custom Install Root"),
      secondCustomRoot: path.join(caseRoot, "Second Custom Install Root"),
      projectsRoot: path.join(caseRoot, "Projects Target"),
      dataRoot: path.join(caseRoot, "Data Target")
    };
    const canonicalRoot = path.join(paths.localAppData, "Programs", "Crocoblock Site Factory");
    const defaultProjectsRoot = path.join(paths.userProfile, "Documents", "Factory Projects");
    const defaultDataRoot = path.join(paths.localAppData, "Crocoblock Site Factory");
    const result = spawnSync("cmd.exe", [
      "/d",
      "/c",
      "call",
      installPath,
      ...entry.args(paths)
    ], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000
    });

    assert.equal(result.status, 2, entry.name + ": " + (result.stderr || result.stdout));
    assert.doesNotMatch(result.stdout, /package files are missing|files could not be installed|is installed/i, entry.name);
    for (const target of [
      canonicalRoot,
      defaultProjectsRoot,
      defaultDataRoot,
      paths.customRoot,
      paths.secondCustomRoot,
      paths.projectsRoot,
      paths.dataRoot
    ]) {
      assert.equal(fs.existsSync(target), false, entry.name + ": " + target);
    }
  }

  const supportedCases = [
    { name: "projects root", args: (paths) => ["--projects-root", paths.projectsRoot] },
    { name: "data root", args: (paths) => ["--data-root", paths.dataRoot] },
    {
      name: "projects and data roots",
      args: (paths) => ["--projects-root", paths.projectsRoot, "--data-root", paths.dataRoot]
    },
    { name: "Unicode root values", args: (paths) => ["--projects-root", paths.unicodeProjectsRoot, "--data-root", paths.unicodeDataRoot] },
    { name: "drive root values", args: (paths) => ["--projects-root", paths.driveRoot, "--data-root", paths.driveRoot] },
    { name: "UNC root values", args: (paths) => ["--projects-root", paths.uncRoot, "--data-root", paths.uncRoot] }
  ];

  for (const [index, entry] of supportedCases.entries()) {
    const caseRoot = path.join(root, "supported-case-" + String(index).padStart(2, "0"));
    const paths = {
      localAppData: path.join(caseRoot, "Local App Data"),
      userProfile: path.join(caseRoot, "User Profile"),
      projectsRoot: path.join(caseRoot, "Projects Target"),
      dataRoot: path.join(caseRoot, "Data Target"),
      unicodeProjectsRoot: path.join(caseRoot, "Проєкти Поточна папка"),
      unicodeDataRoot: path.join(caseRoot, "Дані Поточна папка"),
      driveRoot: path.join(path.parse(caseRoot).root, "CSF Phase0 Parser Drive " + String(index).padStart(2, "0")),
      uncRoot: "\\\\localhost\\C$\\CSF Phase0 Parser UNC " + String(index).padStart(2, "0")
    };
    const result = spawnSync("cmd.exe", [
      "/d",
      "/c",
      "call",
      installPath,
      ...entry.args(paths)
    ], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000
    });

    assert.equal(result.status, 1, entry.name + ": " + (result.stderr || result.stdout));
    assert.match(result.stdout, /package files are missing/i, entry.name);
    assert.equal(fs.existsSync(paths.projectsRoot), false, entry.name);
    assert.equal(fs.existsSync(paths.dataRoot), false, entry.name);
  }
});

test("trusted resolver uses current Windows Known Folders rather than default paths", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  const independent = resolveKnownFolderPathsWithFlags(layout.root);
  const production = resolveTrustedPaths(layout.helperPath);
  const cleanup = fs.readFileSync(path.join(REPOSITORY_ROOT, "launcher", "windows-installer", "uninstall-cleanup.ps1"), "utf8");
  assert.match(cleanup, /\$CurrentKnownFolderFlags\s*=\s*\[uint32\]0/i);
  assert.doesNotMatch(cleanup, /0x00000400|KF_FLAG_DEFAULT_PATH/i);
  for (const key of ["LOCAL", "ROAMING", "DOCUMENTS"]) {
    assert.equal(production[key], independent[key].CURRENT, key + " production selects current path");
  }
  process.stdout.write("INSTALLER_KNOWN_FOLDER_PROOF=" + JSON.stringify({
    local: independent.LOCAL,
    roaming: independent.ROAMING,
    documents: independent.DOCUMENTS,
    production: production,
    production_documents_equals_current: production.DOCUMENTS === independent.DOCUMENTS.CURRENT,
    production_documents_equals_default: production.DOCUMENTS === independent.DOCUMENTS.DEFAULT,
    environment_authority: false,
    default_fallback: false
  }) + "\n");
});

test("installer accepts trusted resolver records only when the child exits 0", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  fs.rmSync(path.join(layout.packageRoot, layout.productName + ".exe"));
  const result = runInstall(layout);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /package files are missing/i);
  assert.doesNotMatch(result.stdout, /Windows known folders could not be resolved/i);
  assert.equal(String(result.stderr || "").trim(), "");
  assert.equal(fs.existsSync(layout.installRoot), false);
  assert.equal(fs.existsSync(layout.shortcutPath), false);
});

test("installer rejects valid resolver paths when the resolver child exits 1", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  const sentinels = createResolverRejectionSentinels(layout);
  replaceResolverResponseFixture(layout.installerHelperPath, resolverRecords(layout), 1);
  assertResolverBoundaryRejected(runInstall(layout), layout);
  assertResolverRejectionSentinels(sentinels);
});

test("installer resolver protocol rejects malformed status and path records before package validation", (t) => {
  const cases = [
    {
      name: "valid paths with child exit 5",
      configure(layout) { replaceResolverResponseFixture(layout.installerHelperPath, resolverRecords(layout), 5); }
    },
    {
      name: "missing status",
      configure(layout) { replaceResolverTransportFixture(layout.installPath, "$null = $process.ExitCode"); }
    },
    {
      name: "malformed status",
      configure(layout) { replaceResolverTransportFixture(layout.installPath, "[Console]::Out.WriteLine('RESOLVER_EXIT|not-an-integer')"); }
    },
    {
      name: "duplicate status",
      configure(layout) { replaceResolverTransportFixture(layout.installPath, "[Console]::Out.WriteLine('RESOLVER_EXIT|' + $process.ExitCode); [Console]::Out.WriteLine('RESOLVER_EXIT|0')"); }
    },
    {
      name: "missing Documents record",
      configure(layout) {
        replaceResolverResponseFixture(layout.installerHelperPath, resolverRecords(layout).filter((record) => !record.startsWith("DOCUMENTS|")), 0);
      }
    },
    {
      name: "duplicate Local record",
      configure(layout) {
        const records = resolverRecords(layout);
        replaceResolverResponseFixture(layout.installerHelperPath, records.concat(records.find((record) => record.startsWith("LOCAL|"))), 0);
      }
    },
    {
      name: "resolver launch unavailable",
      configure(layout) {
        const source = fs.readFileSync(layout.installPath, "utf8");
        const marker = "$info.FileName = 'powershell.exe'";
        assert.equal(source.split(marker).length - 1, 1, "bounded resolver launch substitution");
        fs.writeFileSync(layout.installPath, source.replace(marker, "$info.FileName = 'missing-resolver.exe'"), "utf8");
      }
    },
    {
      name: "invalid Known Folder GUID",
      configure(layout) { replaceFolderIdWithFailureFixture(layout.installerHelperPath); }
    }
  ];
  for (const entry of cases) {
    const layout = createTrustedInstallerFixture();
    t.after(() => cleanupTrustedFixture(layout));
    const sentinels = createResolverRejectionSentinels(layout);
    entry.configure(layout);
    assertResolverBoundaryRejected(runInstall(layout), layout);
    assertResolverRejectionSentinels(sentinels);
  }
});

test("installer validates and uses one authoritative Known Folder snapshot", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  const snapshots = {
    A: {
      local: path.join(layout.root, "snapshot A", "Local"),
      roaming: path.join(layout.root, "snapshot A", "Roaming"),
      documents: path.join(layout.root, "snapshot A", "Documents")
    },
    B: {
      local: path.join(layout.root, "snapshot B", "Local"),
      roaming: path.join(layout.root, "snapshot B", "Roaming"),
      documents: path.join(layout.root, "snapshot B", "Documents")
    }
  };
  for (const snapshot of Object.values(snapshots)) {
    for (const directory of Object.values(snapshot)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.mkdirSync(path.join(snapshot.local, "Programs"), { recursive: true });
  }
  const sentinels = createResolverRejectionSentinels(layout);
  const invocationLog = path.join(layout.root, "authoritative-snapshot.log");
  fs.rmSync(path.join(layout.packageRoot, layout.productName + ".exe"));
  replaceAuthoritativeSnapshotFixture(layout.installerHelperPath);
  const result = runInstall(layout, {
    CSF_TEST_SNAPSHOT_LOG: invocationLog,
    CSF_TEST_SNAPSHOT_A_LOCAL: snapshots.A.local,
    CSF_TEST_SNAPSHOT_A_ROAMING: snapshots.A.roaming,
    CSF_TEST_SNAPSHOT_A_DOCUMENTS: snapshots.A.documents,
    CSF_TEST_SNAPSHOT_B_LOCAL: snapshots.B.local,
    CSF_TEST_SNAPSHOT_B_ROAMING: snapshots.B.roaming,
    CSF_TEST_SNAPSHOT_B_DOCUMENTS: snapshots.B.documents
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const invocationDetails = fs.existsSync(invocationLog) ? fs.readFileSync(invocationLog, "utf8") : "<no invocation log>";
  assert.match(result.stdout, /package files are missing/i, invocationDetails);
  assert.equal(String(result.stderr || "").trim(), "");
  assert.deepEqual(fs.readFileSync(invocationLog, "utf8").trim().split(/\r?\n/), [
    "MODE|ResolveAndValidateInstallPaths",
    "LAYOUT|ResolveAndValidateInstallPaths"
  ]);
  for (const snapshot of Object.values(snapshots)) {
    const installRoot = path.join(snapshot.local, "Programs", ...layout.installDirectoryName.split("\\"));
    const shortcutPath = path.join(snapshot.roaming, "Microsoft", "Windows", "Start Menu", "Programs", layout.productName, layout.productName + ".lnk");
    assert.equal(fs.existsSync(installRoot), false, installRoot);
    assert.equal(fs.existsSync(shortcutPath), false, shortcutPath);
  }
  assert.equal(fs.existsSync(path.join(snapshots.A.documents, "Factory Projects")), false);
  assert.equal(fs.existsSync(path.join(snapshots.B.documents, "Factory Projects")), false);
  assertResolverRejectionSentinels(sentinels);
});

test("spoofed Known Folder environment fails closed before installer mutation", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  fs.mkdirSync(layout.spoofRoot, { recursive: true });
  const spoofMarker = path.join(layout.spoofRoot, "preserved.txt");
  fs.writeFileSync(spoofMarker, "preserved\n", "utf8");
  const result = runInstall(layout, attackerEnvironment(layout));
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(fs.existsSync(layout.installRoot), false);
  assert.equal(fs.existsSync(layout.shortcutPath), false);
  assert.equal(fs.readFileSync(spoofMarker, "utf8"), "preserved\n");
  assert.doesNotMatch(result.stdout, /0x[0-9a-f]+|known_folder_unavailable|attacker controlled root/i);
  emitTrustedProof("environment-spoof-install", layout, { exit: result.status, mutation_reached: false, spoof_root_changed: false, canonical_root_changed: false, external_target_changed: false, shortcut_postcondition: "absent", install_root_postcondition: "absent" });
});

test("spoofed local app data cannot redirect a trusted install", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  fs.mkdirSync(layout.spoofRoot, { recursive: true });
  const spoofMarker = path.join(layout.spoofRoot, "preserved.txt");
  fs.writeFileSync(spoofMarker, "preserved\n", "utf8");
  const result = runInstall(layout, { LOCALAPPDATA: attackerEnvironment(layout).LOCALAPPDATA });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(layout.installRoot), true);
  assert.equal(fs.existsSync(path.join(layout.installRoot, layout.productName + ".exe")), true);
  assert.equal(fs.existsSync(layout.shortcutPath), true);
  assert.equal(fs.readFileSync(spoofMarker, "utf8"), "preserved\n");
  assert.equal(fs.existsSync(layout.spoofShortcutDirectory), false);
  assert.doesNotMatch(result.stdout, /attacker controlled root/i);
  emitTrustedProof("environment-spoof-install", layout, { exit: result.status, mutation_reached: true, spoof_root_changed: false, canonical_root_changed: true, external_target_changed: false, shortcut_postcondition: "present", install_root_postcondition: "present" });
});

test("Known Folder API failure fails closed for install and cleanup without leaking native details", (t) => {
  const installLayout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(installLayout));
  const installEnvironment = attackerEnvironment(installLayout);
  fs.mkdirSync(installLayout.spoofRoot, { recursive: true });
  const installSpoofMarker = path.join(installLayout.spoofRoot, "preserved.txt");
  fs.writeFileSync(installSpoofMarker, "preserved\n", "utf8");
  replaceFolderIdWithFailureFixture(installLayout.installerHelperPath);
  const installResult = runInstall(installLayout, installEnvironment);
  assert.equal(installResult.status, 1, installResult.stderr || installResult.stdout);
  assert.match(installResult.stdout, /Windows known folders could not be resolved\./i);
  assert.equal(String(installResult.stderr || "").trim(), "");
  assert.equal(fs.existsSync(installLayout.installRoot), false);
  assert.equal(fs.existsSync(installLayout.shortcutPath), false);
  assert.equal(fs.readFileSync(installSpoofMarker, "utf8"), "preserved\n");
  assertSanitizedResolverFailure(installResult, installLayout, installEnvironment);
  emitTrustedProof("known-folder-api-failure-install", installLayout, { exit: installResult.status, mutation_reached: false, spoof_root_changed: false, canonical_root_changed: false, external_target_changed: false, shortcut_postcondition: "absent", install_root_postcondition: "absent" });

  const cleanupLayout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(cleanupLayout));
  const cleanupEnvironment = attackerEnvironment(cleanupLayout);
  createValidTrustedInstallation(cleanupLayout);
  fs.mkdirSync(cleanupLayout.shortcutDirectory, { recursive: true });
  fs.writeFileSync(cleanupLayout.shortcutPath, "normal shortcut\n", "utf8");
  fs.mkdirSync(cleanupLayout.spoofRoot, { recursive: true });
  const cleanupSpoofMarker = path.join(cleanupLayout.spoofRoot, "preserved.txt");
  fs.writeFileSync(cleanupSpoofMarker, "preserved\n", "utf8");
  const manifestPath = path.join(cleanupLayout.installRoot, "resources", "package-manifest.json");
  const manifestBefore = fs.readFileSync(manifestPath, "utf8");
  replaceFolderIdWithFailureFixture(cleanupLayout.helperPath);
  const directResolverResult = runTrustedMode(cleanupLayout.helperPath, "ResolveTrustedPaths", cleanupEnvironment);
  assert.equal(directResolverResult.status, 1, directResolverResult.stderr || directResolverResult.stdout);
  assert.equal(String(directResolverResult.stdout || "").trim(), "");
  assert.equal(String(directResolverResult.stderr || "").trim(), "Trusted installer path validation failed.");
  assertSanitizedResolverFailure(directResolverResult, cleanupLayout, cleanupEnvironment);
  const cleanupResult = runCleanupHelper(cleanupLayout, cleanupEnvironment);
  assert.equal(cleanupResult.process.status, 1, cleanupResult.process.stderr || cleanupResult.process.stdout);
  assert.equal(cleanupResult.record.status, "failed");
  assert.equal(fs.existsSync(cleanupLayout.installRoot), true);
  assert.equal(fs.existsSync(cleanupLayout.shortcutPath), true);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), manifestBefore);
  assert.equal(fs.readFileSync(cleanupSpoofMarker, "utf8"), "preserved\n");
  assertSanitizedResolverFailure(Object.assign({}, cleanupResult.process, { record: cleanupResult.record }), cleanupLayout, cleanupEnvironment);
  assert.doesNotMatch(cleanupResult.record.message, /0x[0-9a-f]+|known_folder_unavailable|C:\\Users\\/i);
  emitTrustedProof("known-folder-api-failure-cleanup", cleanupLayout, { exit: cleanupResult.process.status, status: cleanupResult.record.status, code: cleanupResult.record.code, mutation_reached: false, spoof_root_changed: false, canonical_root_changed: false, external_target_changed: false, shortcut_postcondition: "present", install_root_postcondition: "preserved" });
});

test("spoofed cleanup cannot authorize copied identity outside the trusted leaf", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  createValidTrustedInstallation(layout);
  const copied = path.join(layout.spoofRoot, "Copied Identity");
  for (const directory of [path.join(copied, "installer"), path.join(copied, "resources")]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(copied, layout.productName + ".exe"), "copied executable\n", "utf8");
  fs.writeFileSync(path.join(copied, "installer", ".factory-install-root"), "copied marker\n", "utf8");
  fs.writeFileSync(path.join(copied, "resources", "package-manifest.json"), JSON.stringify({ application_name: layout.productName, architecture: "x64", artifact_label: "INTERNAL EVALUATION BUILD" }), "utf8");
  const before = fs.readFileSync(path.join(copied, "resources", "package-manifest.json"), "utf8");
  const result = runCleanupHelper(layout, { LOCALAPPDATA: attackerEnvironment(layout).LOCALAPPDATA, FACTORY_UNINSTALL_ROOT: attackerEnvironment(layout).FACTORY_UNINSTALL_ROOT });
  assert.equal(result.process.status, 0, result.process.stderr || result.process.stdout);
  assert.equal(result.record.status, "succeeded");
  assert.equal(fs.existsSync(layout.installRoot), false);
  assert.equal(fs.readFileSync(path.join(copied, "resources", "package-manifest.json"), "utf8"), before);
  assert.equal(fs.existsSync(layout.spoofShortcutDirectory), false);
  assert.doesNotMatch(result.record.message, /Copied Identity|[A-Za-z]:\\/);
  emitTrustedProof("environment-spoof-cleanup", layout, { exit: result.process.status, status: result.record.status, code: result.record.code, mutation_reached: true, spoof_root_changed: false, canonical_root_changed: true, external_target_changed: false, shortcut_postcondition: "absent", install_root_postcondition: "absent" });
});

test("trusted cleanup removes a valid randomized installation and preserves projects and data", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  createValidTrustedInstallation(layout);
  fs.mkdirSync(layout.shortcutDirectory, { recursive: true });
  fs.writeFileSync(layout.shortcutPath, "normal shortcut\n", "utf8");
  const result = runCleanupHelper(layout);
  assert.equal(result.process.status, 0, result.process.stderr || result.process.stdout);
  assert.equal(result.record.status, "succeeded");
  assert.equal(fs.existsSync(layout.installRoot), false);
  assert.equal(fs.existsSync(path.join(layout.installRoot, layout.productName + ".exe")), false);
  assert.equal(fs.existsSync(layout.shortcutPath), false);
  assert.equal(fs.existsSync(layout.dataRoot), true);
  assert.equal(fs.existsSync(layout.projectRoot), true);
  emitTrustedProof("canonical-cleanup", layout, { exit: result.process.status, status: result.record.status, code: result.record.code, mutation_reached: true, spoof_root_changed: false, canonical_root_changed: true, external_target_changed: false, shortcut_postcondition: "absent", install_root_postcondition: "absent", cleanup_exact_root: true });
});

test("Unicode product identity survives trusted install, shortcut, and cleanup transport", (t) => {
  const layout = createTrustedInstallerFixture({ unicodeProduct: true });
  t.after(() => cleanupTrustedFixture(layout));
  assert.match(layout.productName, /Поточна папка/);
  const install = runInstall(layout);
  assert.equal(install.status, 0, install.stderr || install.stdout);
  assert.equal(fs.existsSync(layout.installRoot), true);
  assert.equal(fs.existsSync(path.join(layout.installRoot, layout.productName + ".exe")), true);
  assert.equal(fs.existsSync(layout.shortcutPath), true);
  assert.doesNotMatch(install.stdout, /�/);
  const cleanup = runCleanupHelper(layout);
  assert.equal(cleanup.process.status, 0, cleanup.process.stderr || cleanup.process.stdout);
  assert.equal(cleanup.record.status, "succeeded");
  assert.equal(fs.existsSync(layout.installRoot), false);
  assert.equal(fs.existsSync(layout.shortcutPath), false);
  emitTrustedProof("unicode-trusted-install-cleanup", layout, { exit: cleanup.process.status, status: cleanup.record.status, code: cleanup.record.code, mutation_reached: true, spoof_root_changed: false, canonical_root_changed: true, external_target_changed: false, shortcut_postcondition: "absent", install_root_postcondition: "absent", unicode_transport: true });
});

test("trusted cleanup accepts an absent shortcut but fails closed for a shortcut directory obstacle", (t) => {
  const absent = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(absent));
  createValidTrustedInstallation(absent);
  const absentResult = runCleanupHelper(absent);
  assert.equal(absentResult.process.status, 0, absentResult.process.stderr || absentResult.process.stdout);
  assert.equal(fs.existsSync(absent.installRoot), false);

  const obstacle = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(obstacle));
  createValidTrustedInstallation(obstacle);
  fs.mkdirSync(obstacle.shortcutPath, { recursive: true });
  const obstacleResult = runCleanupHelper(obstacle);
  assert.equal(obstacleResult.process.status, 1, obstacleResult.process.stderr || obstacleResult.process.stdout);
  assert.equal(obstacleResult.record.status, "failed");
  assert.equal(fs.existsSync(obstacle.installRoot), true);
  assert.equal(fs.existsSync(obstacle.shortcutPath), true);
  assert.doesNotMatch(obstacleResult.record.message, /[A-Za-z]:\\/);
  emitTrustedProof("shortcut-directory-obstacle", obstacle, { exit: obstacleResult.process.status, status: obstacleResult.record.status, code: obstacleResult.record.code, mutation_reached: false, spoof_root_changed: false, canonical_root_changed: false, external_target_changed: false, shortcut_postcondition: "directory-preserved", install_root_postcondition: "preserved" });
});

test("install and cleanup fail closed for trusted install and shortcut reparse boundaries", (t) => {
  const cases = [
    { name: "install root junction", options: {}, target(layout) { return layout.installRoot; } },
    { name: "install parent junction", options: { nestedInstallDirectory: true }, target(layout) { return path.dirname(layout.installRoot); } },
    { name: "shortcut product junction", options: {}, target(layout) { return layout.shortcutDirectory; } }
  ];
  for (const entry of cases) {
    const layout = createTrustedInstallerFixture(entry.options);
    t.after(() => cleanupTrustedFixture(layout));
    const external = path.join(layout.root, entry.name + " external target");
    const linkPath = entry.target(layout);
    fs.mkdirSync(external, { recursive: true });
    fs.writeFileSync(path.join(external, "preserved.txt"), "external\n", "utf8");
    try {
      fs.symlinkSync(external, linkPath, "junction");
    } catch (error) {
      assert.fail(entry.name + ": junction fixture is required: " + error.message);
    }
    const result = runInstall(layout);
    assert.equal(result.status, 1, entry.name + ": " + (result.stderr || result.stdout));
    assert.equal(fs.readFileSync(path.join(external, "preserved.txt"), "utf8"), "external\n", entry.name);
    assert.equal(fs.existsSync(layout.shortcutPath), false, entry.name);
    emitTrustedProof(entry.name, layout, { exit: result.status, mutation_reached: false, spoof_root_changed: false, canonical_root_changed: false, external_target_changed: false, shortcut_postcondition: "absent", install_root_postcondition: "absent" });
    unlinkDirectoryLink(linkPath);
  }
});

test("cleanup rejects a descendant junction without following its external target", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  createValidTrustedInstallation(layout);
  const external = path.join(layout.root, "external descendant target");
  const linkPath = path.join(layout.installRoot, "app", "linked-data");
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, "preserved.txt"), "external\n", "utf8");
  fs.symlinkSync(external, linkPath, "junction");
  const failed = runCleanupHelper(layout);
  assert.equal(failed.process.status, 1, failed.process.stderr || failed.process.stdout);
  assert.equal(failed.record.status, "failed");
  assert.equal(fs.existsSync(layout.installRoot), true);
  assert.equal(fs.readFileSync(path.join(external, "preserved.txt"), "utf8"), "external\n");
  unlinkDirectoryLink(linkPath);
  const completed = runCleanupHelper(layout);
  assert.equal(completed.process.status, 0, completed.process.stderr || completed.process.stdout);
  assert.equal(fs.existsSync(layout.installRoot), false);
  emitTrustedProof("descendant-junction-cleanup", layout, { exit: failed.process.status, status: failed.record.status, code: failed.record.code, mutation_reached: false, spoof_root_changed: false, canonical_root_changed: false, external_target_changed: false, shortcut_postcondition: "absent", install_root_postcondition: "preserved", cleanup_exact_root: true });
});

test("cleanup rejects a shortcut reparse point without following its external target", (t) => {
  const layout = createTrustedInstallerFixture();
  t.after(() => cleanupTrustedFixture(layout));
  createValidTrustedInstallation(layout);
  fs.mkdirSync(layout.shortcutDirectory, { recursive: true });
  const external = path.join(layout.root, "external shortcut target");
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, "preserved.txt"), "external\n", "utf8");
  fs.symlinkSync(external, layout.shortcutPath, "junction");
  const failed = runCleanupHelper(layout);
  assert.equal(failed.process.status, 1, failed.process.stderr || failed.process.stdout);
  assert.equal(failed.record.status, "failed");
  assert.equal(fs.existsSync(layout.installRoot), true);
  assert.equal(fs.readFileSync(path.join(external, "preserved.txt"), "utf8"), "external\n");
  unlinkDirectoryLink(layout.shortcutPath);
  const completed = runCleanupHelper(layout);
  assert.equal(completed.process.status, 0, completed.process.stderr || completed.process.stdout);
  assert.equal(fs.existsSync(layout.installRoot), false);
  emitTrustedProof("shortcut-reparse-cleanup", layout, { exit: failed.process.status, status: failed.record.status, code: failed.record.code, mutation_reached: false, spoof_root_changed: false, canonical_root_changed: false, external_target_changed: false, shortcut_postcondition: "reparse-preserved", install_root_postcondition: "preserved", cleanup_exact_root: true });
});
