# Crocoblock Official Package Provider ADR

Status: Proposed
Date: 2026-07-15
Phase: 19d-b1c

## Context

Phase 19d-a established the Site Factory managed dependency trust boundary:

- approved dependency sources are resolved server-side;
- browser/API responses expose only `key`, `label`, `filename`, `exists`, and `size`;
- package downloads are quarantined, validated, and cached;
- install plans are server-issued and project-scoped;
- installation is coordinator-controlled.

That boundary is currently backed by the development-local provider and local vendor ZIPs.

We also inspected two Crocoblock surfaces for evidence only:

- Crocoblock Wizard
- Jet Dashboard

They show real product mechanics for licensing, package fetching, and plugin install flows, but they do not yet give us a publicly approved contract for a Site Factory official package provider.

## Problem

We need to know whether Site Factory should support a Crocoblock-managed package provider contract in addition to the development-local provider.

The missing question is not whether Crocoblock can fetch packages.
The missing question is:

> What is the officially supported backend contract that Site Factory may rely on for package discovery, identity, authorization, download, and migration?

Without that contract, a direct official-provider implementation would be guesswork.

## Decision

We are not implementing an official Crocoblock package provider until backend support defines the contract.

For now, Site Factory keeps the current trust boundary:

1. approved sources are resolved inside Launcher;
2. package bytes are validated before install;
3. browser-visible responses remain redacted;
4. the current development-local provider stays the reference implementation;
5. any official Crocoblock provider must be added behind an explicit backend contract.

## Required backend contract

The backend must answer the following before implementation begins:

1. What is the canonical provider identity?
2. How does a project obtain a provider-scoped credential?
3. Which request/response fields are supported for package discovery?
4. How are package identity and version pinned?
5. Is the contract project-scoped, site-scoped, or account-scoped?
6. What is the failure behavior for expired credentials, revoked access, or missing package entitlements?
7. What migration path exists for existing projects?
8. What audit evidence is required for support?
9. What fields are guaranteed safe to expose in browser/API responses?
10. What is the supported retry and cache policy?

## Accepted facts from inspection

### Crocoblock Wizard

Evidence showed:

- admin-oriented WordPress UI;
- `manage_options` plus nonce gating;
- license-based package flows;
- plugin/theme installer helpers;
- remote Crocoblock endpoints for internal license and asset resolution.

### Jet Dashboard

Evidence showed:

- account/API driven package discovery;
- license metadata;
- plugin update/install helpers;
- dashboard-oriented internal flows.

### Site Factory

Evidence showed:

- redacted dependency-source API;
- server-issued dependency plans;
- immutable managed cache;
- package safety validation;
- project-level installation coordination.

## Supportability decision

Decision: `GREEN-B`

Meaning:

- the architecture is ready for a backend-approved contract discussion;
- the current implementation should not invent an official provider protocol;
- docs and the questionnaire below are the correct next step;
- implementation should wait for backend answers.

## Deferred decisions

Deferred until backend answers arrive:

- official provider auth model;
- package discovery endpoint shape;
- entitlement and migration model;
- cache keying and pinning policy;
- how official provider provenance is surfaced to users.

## Prohibited approaches

Do not:

- reuse Wizard or Jet Dashboard internals as if they were a supported external contract;
- expose absolute package paths to the browser;
- bypass the managed-package cache;
- rely on browser-supplied ZIP paths;
- add a second ad hoc provider protocol.

## Customer-facing policy

The customer experience should remain simple:

- choose a package source only from supported provider options;
- see clear package names and identities;
- never see raw credential material;
- never have to guess whether a provider is official or local;
- get a supportable failure message when a package cannot be resolved.

## Next step

Use `docs/architecture/crocoblock-official-package-provider-questions.md` as the backend questionnaire for formal contract approval.
