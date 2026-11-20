# Changelog

Notable solution changes are recorded using the categories from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Component package versions are not solution release versions.

## [Unreleased]

No solution release has been tagged or published. This section describes the
current proof of concept rather than a released version.

### Added

- Versioned file definitions, asynchronous file validation, results and
  optional delivery, with user and administrator workflows.
- Natural-language rule proposals through a configured model gateway, with
  restricted SQL validation and administrator review.
- An Azure deployment with Container Apps, managed identities, private data
  endpoints, monitoring, and a separate manually dispatched deployment workflow.
- User and administrator guides and architecture decision records.

### Changed

- The rule authoring integration uses a customer-configured Citadel API
  Management gateway rather than a direct model connection.

### Security

- Azure data-service access uses managed identity and scoped permissions;
  development authentication bypasses are intended only for local use.

See the [Unreleased notes](docs/releases/unreleased.md) for limitations and
validation boundaries.
