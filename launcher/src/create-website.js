"use strict";

const crypto = require("node:crypto");
const net = require("node:net");
const { spawnSync } = require("node:child_process");
const {
  createProjectScaffold,
  listProjects,
  normalizeCanonicalProjectPort,
  readProjectBySlug,
  resolveProjectsRoot,
  saveProjectRecord,
  slugifyProjectName,
  validateExplicitSlug
} = require("./project-store");
const { provisionProject } = require("./provision");
const { installDependency } = require("./install-dependency");
const { createManagedDependencyInstallPlan } = require("./managed-package-cache");
const { installAgent } = require("./install-agent");
const { readDependencies } = require("./dependencies");
const { planProject } = require("./plan");
const { generateProject } = require("./generate");
const { getSiteStatus } = require("./site");
const { evaluateRealEstateContract } = require("./real-estate-contract");
const {
  computeRequestFingerprint,
  runProjectOperation,
  validateIdempotencyKey
} = require("./project-operation-coordinator");
const {
  createOperationId,
  hashValue,
  readOperationById
} = require("./project-operation-store");
const { buildStructuredPersonalization } = require("./prompt-personalization");

const CREATE_PROFILE = "real-estate";
const CREATE_OPERATION_TYPE = "create_website";
const REQUIRED_DEPENDENCIES = Object.freeze(["kava", "jet-engine", "jet-smart-filters"]);
const ALLOWED_REQUEST_FIELDS = Object.freeze([
  "profile",
  "project_name",
  "agency_name",
  "city",
  "phone",
  "email"
]);
const INTERNAL_STAGES = Object.freeze([
  "validate_request",
  "create_project",
  "provision_runtime",
  "install_dependencies",
  "install_agent",
  "verify_agent",
  "create_plan",
  "apply_plan",
  "validate_website",
  "finalize_project"
]);
const CUSTOMER_STAGES = Object.freeze([
  { id: "preparing_project", label: "Preparing project", internal: ["validate_request", "create_project"] },
  { id: "starting_wordpress", label: "Starting WordPress", internal: ["provision_runtime"] },
  { id: "installing_tools", label: "Installing Crocoblock tools", internal: ["install_dependencies"] },
  { id: "connecting_factory", label: "Connecting Site Factory", internal: ["install_agent", "verify_agent"] },
  { id: "creating_website", label: "Creating website", internal: ["create_plan", "apply_plan"] },
  { id: "checking_result", label: "Checking result", internal: ["validate_website", "finalize_project", "verifying", "completed"] }
]);
const pendingStarts = new Map();

function createError(message, code, statusCode, extras) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode || 400;
  if (extras && typeof extras === "object") {
    Object.assign(error, extras);
  }
  return error;
}

function collapseWhitespace(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function validatePlainField(field, value, maxLength) {
  const text = collapseWhitespace(value);
  if (!text) {
    throw createError(field.replace(/_/g, " ") + " is required.", "create_website_invalid_request", 400, {
      field_errors: { [field]: "This field is required." }
    });
  }
  if (text.length > maxLength) {
    throw createError(field.replace(/_/g, " ") + " is too long.", "create_website_invalid_request", 400, {
      field_errors: { [field]: "Use " + String(maxLength) + " characters or fewer." }
    });
  }
  if (/[<>\u0000-\u001f\u007f]/u.test(text)) {
    throw createError(field.replace(/_/g, " ") + " contains unsupported characters.", "create_website_invalid_request", 400, {
      field_errors: { [field]: "Remove markup or control characters." }
    });
  }
  return text;
}

function normalizePhone(value) {
  const phone = collapseWhitespace(value);
  if (!phone) {
    throw createError("Phone is required.", "create_website_invalid_request", 400, {
      field_errors: { phone: "This field is required." }
    });
  }
  if (phone.length > 40 || !/^\+?[0-9() .-]+$/.test(phone)) {
    throw createError("Phone has an invalid format.", "create_website_invalid_request", 400, {
      field_errors: { phone: "Use digits and standard phone punctuation only." }
    });
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw createError("Phone has an invalid length.", "create_website_invalid_request", 400, {
      field_errors: { phone: "Use a phone number containing 7 to 15 digits." }
    });
  }
  return phone;
}

function validateCreateWebsiteRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createError("Create Website request must be an object.", "create_website_invalid_request", 400);
  }
  const unknownFields = Object.keys(input).filter((key) => !ALLOWED_REQUEST_FIELDS.includes(key));
  if (unknownFields.length) {
    throw createError("Create Website request contains unsupported fields.", "create_website_unknown_fields", 400, {
      rejected_fields: unknownFields.sort()
    });
  }
  if (input.profile !== CREATE_PROFILE) {
    throw createError("Website type is not supported.", "create_website_unknown_profile", 400, {
      field_errors: { profile: "Choose Real Estate." }
    });
  }

  const projectName = validatePlainField("project_name", input.project_name, 80);
  if (/[/\\]|(?:^|\s)\.\.(?:\s|$)|^[A-Za-z]:|^\\\\|file:/i.test(projectName)) {
    throw createError("Project name cannot be used as a path.", "create_website_unsafe_project_name", 400, {
      field_errors: { project_name: "Use a customer-facing project name, not a path." }
    });
  }
  const agencyName = validatePlainField("agency_name", input.agency_name, 80);
  const city = validatePlainField("city", input.city, 80);
  const email = collapseWhitespace(input.email).toLowerCase();
  if (!email || email.length > 120 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    throw createError("Email has an invalid format.", "create_website_invalid_request", 400, {
      field_errors: { email: "Enter a valid email address." }
    });
  }

  return {
    profile: CREATE_PROFILE,
    project_name: projectName,
    agency_name: agencyName,
    city,
    phone: normalizePhone(input.phone),
    email
  };
}

function buildCreateWebsitePrompt(request) {
  return [
    "Create the existing presentation-grade Real Estate website.",
    "Agency \"" + request.agency_name.replace(/[\"“”]/g, "") + "\".",
    "City " + request.city + ".",
    "Phone " + request.phone + ".",
    "Email " + request.email + ".",
    "Use the supported turquoise design, English content, and 30 demonstration properties."
  ].join(" ");
}

function assertSystemCheckReady(systemCheck) {
  const state = String(systemCheck && systemCheck.state || "ERROR");
  if (state === "PASS" || state === "WARNING") {
    return;
  }
  const checks = Array.isArray(systemCheck && systemCheck.checks) ? systemCheck.checks : [];
  const blocker = checks.find((check) => check && check.state !== "PASS" && check.state !== "WARNING");
  const error = createError(
    blocker && blocker.message ? String(blocker.message) : "System Check must be ready before creating a website.",
    "create_website_system_check_blocked",
    409
  );
  error.customer_action = blocker && blocker.action && blocker.action.label || "Open System Check and recheck.";
  throw error;
}

function isUnsupportedIpv6Error(host, error) {
  return String(host || "").includes(":")
    && ["EAFNOSUPPORT", "EADDRNOTAVAIL", "ENODEV", "EPROTONOSUPPORT"].includes(String(error && error.code || ""));
}

function probePortAddress(port, host, options) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    let finished = false;
    const finish = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      if (!probe.listening) {
        resolve(result);
        return;
      }
      try {
        probe.close(() => resolve(result));
      } catch (error) {
        resolve({ available: false, unsupported: false });
      }
    };
    probe.once("error", (error) => {
      finish({ available: false, unsupported: isUnsupportedIpv6Error(host, error) });
    });
    try {
      probe.listen({
        port,
        host,
        exclusive: true,
        ipv6Only: Boolean(options && options.ipv6Only)
      }, () => finish({ available: true, unsupported: false }));
    } catch (error) {
      finish({ available: false, unsupported: isUnsupportedIpv6Error(host, error) });
    }
  });
}

async function canBindPort(port, options) {
  const probe = options && options.probeAddress || probePortAddress;
  const addresses = [
    { host: "127.0.0.1", ipv6Only: false },
    { host: "0.0.0.0", ipv6Only: false },
    { host: "::1", ipv6Only: true },
    { host: "::", ipv6Only: true },
    { host: "::", ipv6Only: false }
  ];
  for (const address of addresses) {
    let result;
    try {
      result = await probe(port, address.host, { ipv6Only: address.ipv6Only });
    } catch (error) {
      return false;
    }
    if (result && result.unsupported === true) {
      continue;
    }
    if (!result || result.available !== true) {
      return false;
    }
  }
  return true;
}

const DOCKER_OUTPUT_LIMIT = 1024 * 1024;
const DOCKER_CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/i;
const DOCKER_INSPECT_BATCH_SIZE = 24;

function assertBoundedDockerOutput(output) {
  const text = String(output == null ? "" : output);
  if (Buffer.byteLength(text, "utf8") > DOCKER_OUTPUT_LIMIT) {
    throw new Error("Docker port inventory exceeded the output limit.");
  }
  return text;
}

function parseDockerContainerIds(output) {
  const text = assertBoundedDockerOutput(output).trim();
  if (!text) {
    return [];
  }
  const ids = text.split(/\s+/);
  if (ids.some((id) => !DOCKER_CONTAINER_ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Docker port inventory contained an invalid container identifier.");
  }
  return ids;
}

function collectDockerBindingPorts(bindingMap, ports) {
  if (bindingMap === null) {
    return;
  }
  if (!bindingMap || typeof bindingMap !== "object" || Array.isArray(bindingMap)) {
    throw new Error("Docker port inventory contained an invalid binding map.");
  }
  for (const [containerPort, bindings] of Object.entries(bindingMap)) {
    const key = containerPort.match(/^(\d{1,5})\/([a-z0-9]+)$/i);
    if (!key || Number(key[1]) < 1 || Number(key[1]) > 65535) {
      throw new Error("Docker port inventory contained an invalid container port.");
    }
    if (key[2].toLowerCase() !== "tcp") {
      continue;
    }
    if (bindings === null) {
      continue;
    }
    if (!Array.isArray(bindings)) {
      throw new Error("Docker port inventory contained invalid TCP bindings.");
    }
    for (const binding of bindings) {
      if (!binding || typeof binding !== "object" || Array.isArray(binding)
        || typeof binding.HostIp !== "string" || typeof binding.HostPort !== "string") {
        throw new Error("Docker port inventory contained an invalid TCP binding.");
      }
      if (binding.HostPort === "") {
        continue;
      }
      if (!/^\d+$/.test(binding.HostPort)) {
        throw new Error("Docker port inventory contained an invalid host port.");
      }
      const hostPort = Number(binding.HostPort);
      if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
        throw new Error("Docker port inventory contained an invalid host port.");
      }
      ports.add(hostPort);
    }
  }
}

function parseDockerInspectHostPorts(output, requestedIds) {
  const records = JSON.parse(assertBoundedDockerOutput(output));
  if (!Array.isArray(records) || records.length !== requestedIds.length) {
    throw new Error("Docker inspect returned an incomplete container inventory.");
  }
  const ports = new Set();
  const matchedIds = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)
      || typeof record.Id !== "string" || !DOCKER_CONTAINER_ID_PATTERN.test(record.Id)) {
      throw new Error("Docker inspect returned an invalid container record.");
    }
    const matches = requestedIds.filter((id) => record.Id.toLowerCase().startsWith(id.toLowerCase()));
    if (matches.length !== 1 || matchedIds.has(matches[0])) {
      throw new Error("Docker inspect returned an unexpected container record.");
    }
    matchedIds.add(matches[0]);
    if (!record.HostConfig || typeof record.HostConfig !== "object" || Array.isArray(record.HostConfig)
      || !("PortBindings" in record.HostConfig)
      || !record.NetworkSettings || typeof record.NetworkSettings !== "object" || Array.isArray(record.NetworkSettings)
      || !("Ports" in record.NetworkSettings)) {
      throw new Error("Docker inspect returned an invalid binding structure.");
    }
    collectDockerBindingPorts(record.HostConfig.PortBindings, ports);
    collectDockerBindingPorts(record.NetworkSettings.Ports, ports);
  }
  if (matchedIds.size !== requestedIds.length) {
    throw new Error("Docker inspect returned an incomplete container inventory.");
  }
  return ports;
}

function dockerPortInventoryError() {
  return createError(
    "Docker port availability could not be checked. Recheck the local environment and try again.",
    "create_website_environment_unavailable",
    409,
    { customer_action: "Open System Check and recheck." }
  );
}

function runDockerReadCommand(runner, args) {
  const result = runner("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 10000,
    maxBuffer: DOCKER_OUTPUT_LIMIT
  });
  if (!result || result.error || result.status !== 0 || String(result.stderr || "").trim()) {
    throw new Error("Docker read command failed.");
  }
  return assertBoundedDockerOutput(result.stdout);
}

function readDockerPublishedHostPorts(options) {
  const runner = options && options.spawnSync || spawnSync;
  try {
    const ids = parseDockerContainerIds(runDockerReadCommand(runner, ["ps", "--all", "--quiet"]));
    if (!ids.length) {
      return new Set();
    }
    const batchPortSets = [];
    for (let offset = 0; offset < ids.length; offset += DOCKER_INSPECT_BATCH_SIZE) {
      const batchIds = ids.slice(offset, offset + DOCKER_INSPECT_BATCH_SIZE);
      const inspectOutput = runDockerReadCommand(runner, ["inspect", "--type", "container", ...batchIds]);
      batchPortSets.push(parseDockerInspectHostPorts(inspectOutput, batchIds));
    }
    const ports = new Set();
    for (const batchPorts of batchPortSets) {
      for (const port of batchPorts) {
        ports.add(port);
      }
    }
    return ports;
  } catch (error) {
    throw dockerPortInventoryError();
  }
}

async function findAvailableProjectPort(projectsRoot, options) {
  const hasFirstPort = options && Object.prototype.hasOwnProperty.call(options, "firstPort");
  const firstPort = hasFirstPort ? options.firstPort : 8120;
  if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort > 65535) {
    throw createError("No local website port is available.", "create_website_port_unavailable", 409);
  }
  const usedPorts = new Set(listProjects(projectsRoot)
    .map((project) => normalizeCanonicalProjectPort(project.wp_port))
    .filter((port) => port !== null));
  const publishedPortsReader = options && options.readDockerPublishedHostPorts || readDockerPublishedHostPorts;
  const publishedPorts = await publishedPortsReader(options);
  if (!(publishedPorts instanceof Set)
    || Array.from(publishedPorts).some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw dockerPortInventoryError();
  }
  const probe = options && options.canBindPort || ((port) => canBindPort(port, options));
  for (let port = firstPort; port <= Math.min(firstPort + 1000, 65535); port += 1) {
    if (!usedPorts.has(port) && !publishedPorts.has(port) && await probe(port)) {
      return port;
    }
  }
  throw createError("No local website port is available.", "create_website_port_unavailable", 409);
}

function chooseProjectSlug(request, projectsRoot, requestedSlug) {
  const projects = listProjects(projectsRoot);
  const used = new Set(projects.map((project) => project.slug));
  if (requestedSlug) {
    const selected = validateExplicitSlug(requestedSlug);
    if (used.has(selected)) {
      throw createError("The evaluation project already exists.", "create_website_project_exists", 409);
    }
    return selected;
  }
  const base = slugifyProjectName(request.project_name);
  if (!base) {
    throw createError("Project name did not produce a valid project identifier.", "create_website_unsafe_project_name", 400);
  }
  if (!used.has(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    if (!used.has(base + "-" + String(suffix))) {
      return base + "-" + String(suffix);
    }
  }
  throw createError("A unique project identifier could not be selected.", "create_website_slug_unavailable", 409);
}

function updateCreateWebsiteMetadata(slug, projectsRoot, patch) {
  const state = readProjectBySlug(slug, projectsRoot);
  state.project.create_website = Object.assign({}, state.project.create_website || {}, patch || {}, {
    updated_at: new Date().toISOString()
  });
  saveProjectRecord(state, state.project);
  return state.project;
}

function assertAgentReady(agentResult) {
  const healthReady = String(agentResult && agentResult.health && agentResult.health.status || "") === "ok";
  const capabilities = agentResult && agentResult.capabilities && agentResult.capabilities.capabilities || {};
  if (!healthReady || capabilities.controlled_generate !== true) {
    throw createError("Site Factory connection could not be verified.", "create_website_agent_not_ready", 409);
  }
}

function buildValidationUrlStatus(siteResult, generateResult) {
  return Object.assign(
    {},
    generateResult && generateResult.urlStatus || {},
    siteResult && siteResult.site && siteResult.site.url_status || {}
  );
}

function assertWebsiteValidation(siteResult, contractResult, generateResult) {
  const site = siteResult && siteResult.site || {};
  const urlStatus = buildValidationUrlStatus(siteResult, generateResult);
  const requiredUrls = ["home", "properties", "single_property", "contact"];
  const invalidUrl = requiredUrls.find((key) => Number(urlStatus[key]) !== 200);
  if (!site.generated_site_present || !["ok", "warning"].includes(String(site.generation_status || ""))) {
    throw createError("Generated website did not reach a ready state.", "create_website_validation_failed", 409);
  }
  if (invalidUrl) {
    throw createError("A required website page did not pass validation.", "create_website_validation_failed", 409);
  }
  if (!contractResult || contractResult.status !== "compliant" || contractResult.totals.passed !== 25) {
    throw createError("Real Estate acceptance did not pass.", "create_website_contract_failed", 409);
  }
}

function defaultServices(overrides) {
  return Object.assign({
    createProjectScaffold,
    provisionProject,
    createManagedDependencyInstallPlan,
    installDependency,
    installAgent,
    readDependencies,
    planProject,
    generateProject,
    getSiteStatus,
    evaluateRealEstateContract,
    runProjectOperation,
    createOperationId,
    findAvailableProjectPort
  }, overrides || {});
}

async function executeCreateWebsiteWorkflow(context) {
  const { request, slug, projectsRoot, services, operationId } = context;
  let currentStage = "validate_request";
  const setStage = async (stage, patch) => {
    currentStage = stage;
    updateCreateWebsiteMetadata(slug, projectsRoot, { internal_stage: stage, status: "running" });
    return context.setStage(stage, patch);
  };

  try {
    await setStage("validate_request");
    await setStage("create_project");

    await setStage("provision_runtime");
    const provision = await services.provisionProject({ slug, projectsRoot });

    await setStage("install_dependencies");
    const dependencies = [];
    for (const dependency of REQUIRED_DEPENDENCIES) {
      const plan = services.createManagedDependencyInstallPlan({ slug, dependency, projectsRoot });
      const installed = await services.installDependency({
        slug,
        projectsRoot,
        planId: plan.plan.plan_id,
        allowBeforeAgent: true
      });
      dependencies.push({
        key: dependency,
        installed: installed.proof && installed.proof.installed === true,
        active: installed.proof && installed.proof.active === true
      });
    }

    await setStage("install_agent");
    const agent = await services.installAgent({ slug, projectsRoot });

    await setStage("verify_agent");
    assertAgentReady(agent);
    const dependencyVerification = await services.readDependencies({ slug, projectsRoot });
    if (dependencyVerification.blockers && dependencyVerification.blockers.length) {
      throw createError("Required Crocoblock tools are not ready.", "create_website_dependencies_not_ready", 409);
    }

    await setStage("create_plan");
    const prompt = buildCreateWebsitePrompt(request);
    const structuredPersonalization = buildStructuredPersonalization(request);
    const plan = await services.planProject({
      slug,
      projectsRoot,
      prompt,
      structuredPersonalization
    });
    if (!plan.run || !["ok", "warning"].includes(String(plan.run.status || ""))) {
      throw createError("Website plan did not reach a ready state.", "create_website_plan_failed", 409);
    }

    await setStage("apply_plan");
    const generated = await services.generateProject({
      slug,
      projectsRoot,
      planId: plan.run.run_id,
      operationId,
      onProgress: async (statusDetail) => {
        if (statusDetail === "generating") {
          await context.setStage("apply_plan", { safety: { apply_used: true } });
        }
      }
    });

    await setStage("validate_website");
    const site = await services.getSiteStatus({ slug, projectsRoot, persistProject: false, checkUrls: true });
    const contract = services.evaluateRealEstateContract({ slug, projectsRoot });
    const urlStatus = buildValidationUrlStatus(site, generated);
    assertWebsiteValidation(site, contract, generated);

    await setStage("finalize_project");
    const counts = generated.afterCounts || site.site.counts_summary || {};
    const resultSummary = {
      status: "ready",
      website_url: site.site.generated_urls.home || site.project.wp_url,
      pages_created: Number(counts.pages || 0),
      properties_created: Number(counts.properties || 0),
      validation_passed: true,
      url_status: Object.fromEntries(Object.entries(urlStatus).filter(([key]) => ["home", "properties", "single_property", "contact"].includes(key))),
      contract: {
        status: contract.status,
        passed: contract.totals.passed,
        total: contract.totals.total
      },
      dependencies
    };
    updateCreateWebsiteMetadata(slug, projectsRoot, {
      status: "ready",
      internal_stage: "finalize_project",
      completed_at: new Date().toISOString(),
      result: resultSummary,
      failure: null
    });
    return {
      result: resultSummary,
      resultSummary,
      proofRef: generated.proofPath || null
    };
  } catch (error) {
    error.createWebsiteStage = error.createWebsiteStage || currentStage;
    throw error;
  }
}

function findExistingRequest(projectsRoot, idempotencyKeyHash) {
  return listProjects(projectsRoot).map((project) => {
    try {
      return readProjectBySlug(project.slug, projectsRoot).project;
    } catch (error) {
      return null;
    }
  }).filter(Boolean).find((project) => {
    const create = project.create_website || {};
    return create.idempotency_key_hash === idempotencyKeyHash;
  }) || null;
}

function safeFailure(stage) {
  const customer = CUSTOMER_STAGES.find((entry) => entry.internal.includes(stage));
  return {
    stage: customer ? customer.id : "checking_result",
    message: "We couldn’t finish creating the website. The operation did not report success."
  };
}

async function startCreateWebsiteInternal(options) {
  const request = validateCreateWebsiteRequest(options.request);
  assertSystemCheckReady(options.systemCheck);
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const idempotency = validateIdempotencyKey(options.idempotencyKey);
  const idempotencyKeyHash = hashValue(idempotency.raw);
  const requestFingerprint = computeRequestFingerprint({ operation_type: CREATE_OPERATION_TYPE, request });
  const existing = findExistingRequest(projectsRoot, idempotencyKeyHash);
  if (existing) {
    const create = existing.create_website || {};
    if (create.idempotency_key_hash === idempotencyKeyHash && create.request_fingerprint !== requestFingerprint) {
      throw createError("This Create request key was already used for different details.", "idempotency_key_conflict", 409);
    }
    return getCreateWebsiteStatus({ slug: existing.slug, projectsRoot });
  }

  const services = defaultServices(options.services);
  const slug = chooseProjectSlug(request, projectsRoot, options.projectSlug);
  const port = await services.findAvailableProjectPort(projectsRoot, options.portOptions);
  const operationId = services.createOperationId();
  services.createProjectScaffold({ name: request.project_name, slug, port, projectsRoot });
  updateCreateWebsiteMetadata(slug, projectsRoot, {
    schema: "factory_create_website",
    version: 1,
    status: "requested",
    profile: request.profile,
    business: {
      agency_name: request.agency_name,
      city: request.city,
      phone: request.phone,
      email: request.email
    },
    operation_id: operationId,
    idempotency_key_hash: idempotencyKeyHash,
    request_fingerprint: requestFingerprint,
    internal_stage: "create_project",
    created_at: new Date().toISOString()
  });

  const operationPromise = services.runProjectOperation({
    slug,
    projectsRoot,
    operationId,
    operationType: CREATE_OPERATION_TYPE,
    idempotencyKey: idempotency.raw,
    requestFingerprint,
    fingerprintInput: request,
    metadata: { profile: request.profile },
    safety: { live_ai_used: false, apply_used: false, rollback_used: false },
    execute: (operationContext) => executeCreateWebsiteWorkflow({
      request,
      slug,
      projectsRoot,
      services,
      operationId,
      setStage: operationContext.setStage
    })
  });
  operationPromise.catch((error) => {
    updateCreateWebsiteMetadata(slug, projectsRoot, {
      status: "setup_failed",
      internal_stage: error.createWebsiteStage || "create_project",
      completed_at: new Date().toISOString(),
      failure: safeFailure(error.createWebsiteStage)
    });
  });

  return getCreateWebsiteStatus({ slug, projectsRoot });
}

async function startCreateWebsite(options) {
  const request = validateCreateWebsiteRequest(options.request);
  const idempotency = validateIdempotencyKey(options.idempotencyKey);
  const pendingKey = hashValue(idempotency.raw) + ":" + computeRequestFingerprint(request);
  if (pendingStarts.has(pendingKey)) {
    return pendingStarts.get(pendingKey);
  }
  const promise = startCreateWebsiteInternal(Object.assign({}, options, {
    request,
    idempotencyKey: idempotency.raw
  })).finally(() => pendingStarts.delete(pendingKey));
  pendingStarts.set(pendingKey, promise);
  return promise;
}

function buildProgress(operation, createMetadata) {
  const operationStatus = operation && operation.status || createMetadata.status || "requested";
  const activeStage = operation && operation.stage || createMetadata.internal_stage || "validate_request";
  const failedStage = operationStatus === "failed" || operationStatus === "interrupted"
    ? operation && operation.error && operation.error.stage || activeStage
    : null;
  const activeIndex = INTERNAL_STAGES.indexOf(activeStage);

  return CUSTOMER_STAGES.map((customerStage) => {
    let status = "pending";
    if (operationStatus === "succeeded" || createMetadata.status === "ready") {
      status = "complete";
    } else if (failedStage && customerStage.internal.includes(failedStage)) {
      status = "failed";
    } else {
      const internalIndexes = customerStage.internal.map((stage) => INTERNAL_STAGES.indexOf(stage)).filter((index) => index >= 0);
      const firstIndex = internalIndexes.length ? Math.min(...internalIndexes) : INTERNAL_STAGES.length;
      const lastIndex = internalIndexes.length ? Math.max(...internalIndexes) : INTERNAL_STAGES.length;
      if (activeIndex > lastIndex) {
        status = "complete";
      } else if (activeIndex >= firstIndex && activeIndex <= lastIndex || activeStage === "verifying" && customerStage.id === "checking_result") {
        status = failedStage ? "failed" : "active";
      }
    }
    return { id: customerStage.id, label: customerStage.label, status };
  });
}

function getCreateWebsiteStatus(options) {
  const projectsRoot = resolveProjectsRoot(options.projectsRoot);
  const state = readProjectBySlug(options.slug, projectsRoot);
  const create = state.project.create_website || {};
  if (create.schema !== "factory_create_website") {
    throw createError("Create Website operation was not found.", "create_website_not_found", 404);
  }
  const operationEntry = create.operation_id ? readOperationById({
    slug: state.project.slug,
    projectsRoot,
    operationId: create.operation_id,
    includeRaw: false
  }) : null;
  const operation = operationEntry && operationEntry.operation || null;
  const succeeded = operation && operation.status === "succeeded" || create.status === "ready";
  const failed = operation && ["failed", "interrupted"].includes(operation.status) || create.status === "setup_failed";
  const result = operation && operation.result_summary && Object.keys(operation.result_summary).length
    ? operation.result_summary
    : create.result || null;
  return {
    ok: true,
    status: succeeded ? "ready" : failed ? "failed" : "running",
    project: {
      name: state.project.site_name,
      slug: state.project.slug,
      website_url: result && result.website_url || state.project.wp_url
    },
    business: create.business || {},
    progress: buildProgress(operation, create),
    result: succeeded ? result : null,
    failure: failed ? create.failure || safeFailure(operation && operation.error && operation.error.stage) : null,
    technical_details: buildProgress(operation, create).map((stage) => ({ stage: stage.label, status: stage.status }))
  };
}

module.exports = {
  ALLOWED_REQUEST_FIELDS,
  CREATE_OPERATION_TYPE,
  CREATE_PROFILE,
  CUSTOMER_STAGES,
  DOCKER_INSPECT_BATCH_SIZE,
  INTERNAL_STAGES,
  REQUIRED_DEPENDENCIES,
  assertSystemCheckReady,
  buildCreateWebsitePrompt,
  buildProgress,
  canBindPort,
  executeCreateWebsiteWorkflow,
  findAvailableProjectPort,
  getCreateWebsiteStatus,
  isUnsupportedIpv6Error,
  normalizePhone,
  parseDockerInspectHostPorts,
  readDockerPublishedHostPorts,
  startCreateWebsite,
  validateCreateWebsiteRequest
};
