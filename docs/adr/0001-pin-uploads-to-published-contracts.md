---
id: ADR-0001
applies_to:
  - "Back-End/src/services/DefinitionVersion.service.ts"
  - "Back-End/src/services/upload/**"
  - "Validation-Service/src/dq_engine/**"
  - "contracts/**"
status: Accepted
---

# ADR-0001: Pin Uploads to Published Validation Contracts

- **Deciders:** Not recorded; documented retrospectively from the implementation.
- **Date:** 2026-11-20
- **Technical Story:** Explain reproducible validation when administrators publish
  changes while uploads and retries are in flight.

## Agent Rules

- **MUST** associate each upload with a published version of its definition and
  resolve validation and retries against that version's contract.
- **MUST NOT** substitute a later draft or active version when reprocessing an
  existing upload.

## Verify

- **Check:** Review `Back-End/src/services/upload/uploadCreation.ts` and
  `Back-End/src/services/upload/validationStart.ts`, then run
  `npm test -- --runInBand UploadCreation.test.ts` from `Back-End`. Run
  `DefinitionVersioning.integration.test.ts` with a disposable configured test
  database for publication behavior; inspect retry resolution separately.
- **Expected:** New uploads record a valid version; existing uploads resolve
  their pinned contract, and the tests pass without changing a real database.

## Context and Problem Statement

Definitions and rules change over time, but an upload's checks must remain
explainable when it is retried or inspected after publication of a new version.
How should validation obtain a stable contract?

## Decision Drivers

- Preserve validation context for existing uploads and retries.
- Allow administrators to publish changed contracts without rewriting history.

## Considered Options

The original deliberation was not recorded. These alternatives explain the
implemented choice rather than asserting a historical evaluation.

- Persist a published contract snapshot and pin the upload to it.
- Resolve the current active definition every time validation runs.

## Decision Outcome

Use a published contract snapshot, including tables, enabled rules and hydrated
lookup values, and pin each upload to its version. Some definition metadata is
not part of the validation contract and can apply immediately.

### Positive Consequences

- Subsequent edits do not silently alter the validation contract for an upload.
- Version history explains which rules were used.

### Negative Consequences

- Snapshots and version-aware reads add persistence and migration complexity.
- Versioning alone does not solve all parsing or cached-preview limitations.

## Pros and Cons of the Options

### Published snapshot

- Good: validation can resolve the recorded version after later edits.
- Bad: snapshot compatibility must be maintained as contracts evolve.

### Current active definition

- Good: simpler reads and no historical snapshot lookup.
- Bad: retries could use different rules from the original upload.

## Links

- Implemented by [version service](../../Back-End/src/services/DefinitionVersion.service.ts)
  and [upload creation](../../Back-End/src/services/upload/uploadCreation.ts).
- Related: [definition versions](../../README.md#definition-versions).
