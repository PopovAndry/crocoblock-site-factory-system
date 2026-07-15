# Crocoblock Official Package Provider Questionnaire

Purpose: collect the backend contract needed before Site Factory implements an official Crocoblock package provider.

## 1. Provider identity

1. What is the official provider name we should surface in Site Factory?
2. Is the provider account-scoped, site-scoped, or project-scoped?
3. What stable identifiers should Site Factory store for the provider?

## 2. Authentication

4. What authentication mechanism is supported for package discovery and download?
5. Is there a provider-scoped API key, token, signed request, or session exchange?
6. Does the credential need rotation, expiry, or revocation support?
7. Which fields may be stored locally, and which must never be persisted?

## 3. Package discovery

8. What is the supported request shape for listing packages?
9. What fields identify a package unambiguously?
10. How are product name, package name, version, and build channel represented?
11. Can a project pin an exact version or checksum?

## 4. Download and integrity

12. What download URL shape is officially supported?
13. Is checksum or signature verification provided?
14. Are retries, mirrors, or temporary URLs supported?
15. What is the expected failure mode when an asset is missing or revoked?

## 5. Migration

16. How should existing local-provider projects migrate to the official provider?
17. Can one project keep both local and official sources during transition?
18. What is the rollback story if a migration fails halfway?

## 6. Support and audit

19. What evidence do support teams need to debug a failed install?
20. Which fields are safe to expose in browser/API responses?
21. What audit trail should be retained locally?
22. Are there any rate limits or entitlement checks we must honor?

## 7. UX expectations

23. What should the user see when the official provider is unavailable?
24. Should unsupported packages fall back to local ZIPs or fail closed?
25. What terminology should the UI use for the official provider?

## 8. Security boundaries

26. May Site Factory cache downloaded bytes locally?
27. Should Site Factory ever persist provider credentials in project files?
28. Are there any provider fields that must be redacted from logs and proofs?
29. Are browser-visible provider labels allowed to include account names or project names?

## 9. Implementation approval

30. Which backend endpoint or contract document should Site Factory implement against?
31. Who signs off on the final contract?
32. What is the expected availability date for the supported provider contract?

## Short answer requested

Please return:

- the supported contract name;
- the required auth model;
- the discovery response shape;
- the download/integrity policy;
- the migration policy;
- the safe browser-visible fields.
