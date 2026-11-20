---
id: ADR-0002
applies_to:
  - "Back-End/src/services/naturalLanguageRule/**"
  - "Validation-Service/src/dq_engine/rules/**"
  - "Validation-Service/src/dq_engine/api/**"
  - "contracts/rule-config.schema.json"
status: Accepted
---

# ADR-0002: Validate Natural-Language Rule Proposals

- **Deciders:** Not recorded; documented retrospectively from the implementation.
- **Date:** 2026-11-20
- **Technical Story:** Safely turn an administrator's description into a rule
  that can be reviewed and published.

## Agent Rules

- **MUST** validate proposed rule configurations and natural-language SQL
  against the definition and run their examples through the validation service.
- **MUST NOT** execute model output as generated application code or apply a
  proposal to uploads before administrator publication.
- **SHOULD** surface actionable, sanitized rejection messages without logging
  rule text or example values by default.

## Verify

- **Check:** From `Validation-Service`, run
  `uv run pytest tests/rules/test_sqlguard.py`; manually review the authoring
  validation and publication paths and their tests for example execution and
  publication gating.
- **Expected:** SQL guard tests pass, rejected SQL is not executed, and the
  reviewed proposal remains a draft until publication.

## Context and Problem Statement

Administrators want to describe validation checks in ordinary language, while
model responses can be invalid or unsafe and may not mean what the author
intended. How can proposals be made usable without treating the model as a
trusted code generator?

## Decision Drivers

- Bound what generated SQL can access and execute.
- Give administrators a review and publication boundary.
- Avoid sending uploaded file contents to the model.

## Considered Options

The original deliberation was not recorded. These alternatives explain the
implemented choice rather than asserting a historical evaluation.

- Validate declarative rules or restricted SQL and examples before review.
- Execute unrestricted model-generated code or SQL.

## Decision Outcome

Return a proposal as a built-in rule or restricted SQL rule. The rules service
validates the configuration, guards SQL and runs examples; an administrator
reviews and publishes the definition before the rule applies to uploads.

### Positive Consequences

- Guarded proposals and examples expose many invalid or unsafe responses.
- The publication step retains human control over validation behavior.

### Negative Consequences

- Examples and SQL restrictions cannot prove semantic equivalence to the request.
- Model requests add gateway dependency, latency, cost and data-handling review.

## Pros and Cons of the Options

### Validated proposal

- Good: constrained execution and explicit review reduce the trust placed in
  model output.
- Bad: some desired rules cannot be represented and must be rejected.

### Unrestricted generated code or SQL

- Good: could express a wider range of checks.
- Bad: expands execution and data-access risk and removes useful guardrails.

## Links

- Implemented by [SQL guard](../../Validation-Service/src/dq_engine/rules/sqlguard.py)
  and [authoring validation](../../Back-End/src/services/naturalLanguageRule/validation.ts).
- Related: [natural-language rule guide](../natural-language-rules.md).
