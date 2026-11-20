# Data Ingestion Platform: Unreleased

**Status:** working proof of concept; not a published release. Snapshot described
on 2026-11-20. The Node packages each report version 1.0.0 and the Python
package reports 0.1.0; these are component versions, not an authoritative
solution release version.

## Summary

The solution demonstrates definition-driven file ingestion, validation and
optional delivery, locally or in an Azure development environment.

## Highlights

- Publish versioned definitions and pin uploads to the active validation contract.
- Review validation results, issue reports and delivery status in the UI.
- Propose rules through a model gateway; validate proposals and have an
  administrator review them before publication.
- Use an Azure-native deployment with managed identities and private data endpoints.

## Compatibility and Prerequisites

Local development targets Node.js 24, Python 3.12 with `uv`, Docker Desktop
and PowerShell. The Python package requires Python >=3.12,<3.13. Azure requires
the services, permissions, registrations and customer-supplied settings in the
[deployment runbook](../deployment.md#prerequisites).

## Installation or Upgrade

Follow [Getting Started](../../README.md#getting-started) for local setup and
the [administrator guide](../admin-guide.md#upgrades-and-rollback) for upgrade
and rollback precautions. No general upgrade or data migration guarantee is
made for existing installations.

## Known Limitations

This is not production-ready. Authenticated Azure delivery, replay, download
and deletion acceptance is pending. Session revocation, retention, malware
scanning and a complete recovery plan remain open. Database-to-queue handoff
is not crash-recoverable; delivery attempts also have a known stale-attempt
gap. See the [handover](../poc-handover.md) and [backlog](../../TODO.md).

## Validation

The [handover](../poc-handover.md#verified-state) records prior checks and their
scope. They are not evidence of a current release run. Database-backed,
browser, emulator and authenticated Azure acceptance require their respective
environments and must be run separately.

## Security and Privacy

Keep credentials out of source control. Rule requests and schema names go to
the configured gateway; do not include sensitive data in rule text. The
customer must assess gateway data handling and approve cloud costs and access.
See the [administrator guide](../admin-guide.md#security-and-privacy-checklist).

## Documentation

- [User guide](../user-guide.md)
- [Administrator guide](../admin-guide.md)
- [Architecture decisions](../adr/index.md)
- [Changelog](../../CHANGELOG.md)
