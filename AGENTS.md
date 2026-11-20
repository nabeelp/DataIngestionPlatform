# Repository Guidance

This repository contains the Data Ingestion Platform proof of concept.

<!-- BEGIN: documentation-maintenance -->
## Documentation Maintenance

Update the documentation in the same change as the behavior it describes, or state why no update is needed.

- `README.md` — keep Getting Started, navigation and feature descriptions current; link to the guides.
- `CHANGELOG.md` — record user-visible changes under the appropriate Unreleased headings.
- `docs/releases/unreleased.md` — update the snapshot and validation boundaries when the solution changes; add release notes when a solution release is made.
- `docs/user-guide.md` — update workflows, states, accessibility, recovery and screenshots when user-facing behavior changes.
- `docs/admin-guide.md` — update prerequisites, configuration, operations and troubleshooting when deployment or configuration changes.
- `docs/adr/` — record durable decision changes in a new scoped ADR and supersede the prior record when appropriate.
- `docs/adr/index.md` — update the entry whenever an ADR is added, superseded or re-dated.
- Run `node scripts/check-docs.mjs` and verify links in nested documentation before finishing documentation changes.
<!-- END: documentation-maintenance -->
