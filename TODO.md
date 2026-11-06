# Backlog

The single register of open work. It consolidates the earlier whole-solution review, which was re-verified against the current
source, and the follow-ups from the cleanup that removed legacy code. Priorities are delivery priorities: **P0** resolve before promising the capability,
**P1** fix before broader customer-data or production use, **P2** hardening and completion, **P3** optimisation. Status is **Open** or **Partial**;
resolved items are removed. Update this file in the same change that fixes or adds an item.

## Next

- **Azure deployment acceptance:** after explicit owner approval, run the authenticated OPS-01 workflow (delivery, replay, owner-authorized download, deletion)
  against the deployed environment. See [docs/deployment.md](docs/deployment.md).
- **Token storage and revocation** (part of AUTH-01): move the app JWT from `localStorage` to an httpOnly SameSite cookie with CSRF protection, and add revocation.

## P0

| ID | Item | Status | Next action |
|---|---|---|---|
| OPS-01 | Delivery is durable in code (Blob provider, download, delete) but live Azure acceptance is pending | Partial | Record acceptance evidence; add the stale-attempt guard (FUN-04). Remove the local file-copy provider (`DELIVERY_PROVIDER=local`, `DELIVERY_ROOT_PATH`) once Azure delivery is accepted |

## P1

| ID | Item | Status | Next action |
|---|---|---|---|
| FUN-01 | Full-contract changes (encoding, header row, row limits, nullability, lookup values, rule parameters) are invisible to version diffing and publishing | Open | Diff canonical full contracts including hydrated lookups; show the full effective version in the versions modal |
| FUN-02 | Definition deletion removes user access first and can then fail on referenced versions | Open | Choose archive, reject or transactional delete; wrap in one transaction; align the UI and README |
| FUN-03 | Upload deletion leaves child rows (results, rule details, sheets, delivery records) | Open | Delete children transactionally; make cross-store (SQL and Blob) deletion ordered and retryable |
| FUN-04 | A stale delivery request can complete a newer attempt (empty record list counts as delivered); worker artifacts overwrite by upload ID | Open | Persist an attempt/generation in requests, events and artifact paths; require expected target records before completing |
| FUN-05 | Database-to-queue handoff is not crash-recoverable (status set before send; no outbox or reconciler; no dead-letter runbook) | Open | Add a transactional outbox or stale-work reconciler and a dead-letter inspect/redrive runbook |
| AUTH-01 | Sessions are not revoked when role, active state or password change; logout is a no-op; sockets authenticate once; 24h token in `localStorage` | Open | Add session-version or active-user checks (HTTP and sockets), real logout revocation and the chosen browser-token design |
| AUTH-02 | No production first-administrator bootstrap, recovery, last-admin protection or password reset | Open | Decide SSO-only versus a password lifecycle; document or implement bootstrap and recovery |
| VAL-01 | Numeric and date semantics differ between column checks and rules (aggregate and date-range ignore declared separators/formats; native Excel dates cast to text; precision/scale counted on text) | Open | Route every rule through declared column parsing; normalise native Excel types; use DECIMAL semantics |
| VAL-02 | Cached Parquet previews (dry run) lose source failures, physical row numbers and table identity | Open | Persist a staging manifest and match tables by stable identity |
| VAL-03 | Single-layout query rules see only the first workbook sheet | Open | Run per sheet or on a combined table with sheet identity; add first/middle/last-sheet tests |
| EXP-01 | CSV exports (issues report, compliance, activity) lack formula-injection neutralisation | Open | One policy for leading `= + - @`, tab and CR in server and client exports |
| UI-01 | Failed login and expired-session recovery conflict with the authentication loading state | Open | Separate loading from failure; recover to the sign-in page with the reason |
| UI-02 | Multi-value text fields (enum values, ignored sheets) drop a trailing separator while typing | Open | Keep raw text until blur or use tokens; add mounted typing tests |
| UI-03 | Upload drop zone and definition rows are not keyboard-operable | Open | Use a real button/label and a button or link per definition row, with visible focus |

## P2

| ID | Item | Status | Next action |
|---|---|---|---|
| FUN-06 | Deleting a referenced lookup breaks draft-dependent reads and the definition list | Partial | Block or resolve referenced-lookup deletion; make list reads fault-tolerant per definition; read published rules without the draft |
| FUN-07 | Inactive definitions are not blocked at upload admission or hidden in the selector | Open | Enforce `Status = 'Active'` server-side (decide retry policy) and disable inactive definitions in the UI |
| GOV-01 | Audit covers admin writes only; audit is written after the mutation commits | Open | Define an event matrix (rules, uploads, retries, deletes, report downloads, auth); make audit transactional or outbox-backed |
| API-01 | Unbounded query parameters, typed error status codes ignored, and duplicate legacy `/definitions` CRUD alongside `/admin/file-definitions` | Open | Shared bounded query validation; honour typed status codes; remove or align the duplicate routes |
| VAL-04 | Authoring and publication checks differ: no duplicate rule-ID check, several tables allowed in single layout, row expressions need not be Boolean, NL rules authorize their own columns | Partial | Add the missing checks and decide the NL extra-column and example policies |
| VAL-06 | Encoding sniffing decodes a 64 KiB sample as strict UTF-8 before honouring an explicit encoding | Open | Make an explicit non-auto encoding authoritative; decode the sample incrementally |
| UI-04 | Example editor keys rows by index and keeps unparsed JSON local, so invalid JSON is not reflected in run/save | Partial | Stable example IDs; propagate JSON validity |
| UI-05 | Upload and user lists search only the current page; the lookup list shows a non-interactive "+N more" | Partial | Server-side search and paging; a lookup detail view |
| UI-06 | Load failures are logged, not shown; reconnects do not reconcile state | Open | Show errors with retry; refetch on socket reconnect |
| DATA-01 | No end-to-end retention policy (only `staging` expires; uploads, reports, templates, deliveries and database rows do not) | Open | Agree an artifact-by-artifact policy and implement retryable cleanup |
| OPS-06 | Worker and frontend deploy targets skip schema migration gating; API deploys before the schema job; no rollback record | Partial | Gate worker and API on schema compatibility; record image and schema versions; define rollback |
| OPS-07 | Recreated managed identities leave stale SQL users (matched by name only) | Open | Compare the expected SID; recreate or fail with a diagnostic |
| OPS-08 | `/health` is static; no readiness split, alerts, SLOs or recovery runbooks | Open | Split liveness and readiness; add backlog, dead-letter and stuck-work alerts; define SLO, RPO and RTO |
| OPS-09 | The worker identity can read all Key Vault secrets although it needs only the telemetry one | Open | Accept the PoC boundary explicitly or separate the vault or scope |
| PERF-01 | Dense-error workloads are unproven (per-rule materialisation, 1,000,000-issue report cap) | Open | Bound intermediate materialisation; measure 0/1/50/100% failure density on the 4 vCPU / 8 GiB reference host |
| QA-01 | Integration suites skip without a database; no SQL/emulator, browser or container gate in CI | Partial | Add a disposable-database and emulator CI job and a smoke gate that cannot skip |
| DOC-01 | Manifest and snapshot disagree for a few samples (for example duplicate headers); the lockout comment in `User.model.ts` says 5 but the threshold is 4 | Partial | Align the manifest expectations with the golden snapshot where the engine intentionally differs; fix the comment |

## P3

| ID | Item | Status | Next action |
|---|---|---|---|
| LOCAL-01 | `start.ps1` preflight omits the configured rules-service port | Partial | Add the rules port to the preflight list |
| PERF-02 | The frontend bundle (about 1.1 MB) includes every route eagerly | Open | Add route-level lazy loading or targeted chunks |

## Maintainability follow-ups from the legacy cleanup

| ID | Item | Next action |
|---|---|---|
| MAINT-01 | **Contract-only definition API.** Definitions still travel in two shapes: the versioned `contract` and a legacy projection (`columns`/`tables` with a `required` flag; rules as `ruleType` plus a text `expression` such as `Column: a, b`, and a persisted `SqlQuery` column). The example analyzer, the editor, version snapshots and the sample definitions all use the legacy shape | Return and accept only `contract` and `RuleConfig[]`; have the analyzer return `RuleConfig` suggestions; drop `contractMapper` legacy functions, `Rule.model.ruleConfigFromLegacy`, `Rules.SqlQuery`, `legacySnapshotFromContract`, the `toEditorTable` merge in `FileDefinitions.tsx`, and convert `samples/definitions` and `Back-End/database/sample_file_definitions.sql` (duplicates of one another). Needs the Playwright suites (`Front-End/e2e`) run against the full stack |
| MAINT-02 | Oversized modules: `FileDefinitions.tsx` (about 1,800 lines), `NaturalLanguageRule.service.ts` (about 1,400), `admin.controller.ts` (about 900), `Upload.service.ts`, `upload.controller.ts`, `UploadDetails.tsx`, `adminApi.ts`, Python `engine.py` and `api/validation.py` | Split along the existing seams (editor hooks and subcomponents; prompt, model call, validate/retry; controllers by domain; rule registry, issue formatting, query runner, structural checks) and rename the four overlapping rule services (`Rule`, `RuleAuthoring`, `RulesService`, `NaturalLanguageRule`) by responsibility |
| MAINT-03 | Front-End data layer: pages and `uploadApi.ts` duplicate fetch/auth/error handling instead of `services/http.ts`; React Query is installed but unused for server state; `UploadDetails.tsx` still normalises PascalCase and camelCase fallbacks the API never returns | Route all services through `apiRequest`; adopt React Query for lists and details; normalise to the real response shape |
| MAINT-06 | Test coverage gaps: `Upload.service`, `AzureStorage`, `FileDefinition.service`, `Stats`/`Dashboard` services; Front-End `AuthContext`, `lookupApi` and most pages; Python `config`, `io/blob`, `api/app` lifecycle | Add focused tests (blob failure and cleanup, authorization, error mapping, auth/session handling) |
| MAINT-07 | Development-only shortcuts are spread through production code: frontend hard-coded mock users (`VITE_DEV_BYPASS_AUTH`), backend mock tokens (`DEV_BYPASS_AUTH`), the Python shared-key mode that is the default when `RULES_SERVICE_AUTH_MODE` is unset, and local seed SQL (`seed_local_users.sql`, `seed_user_assignments.sql`, `sample_file_definitions.sql`) beside the schema scripts | Isolate each behind one dev-only module or folder (`Back-End/database/local/`), and make the rules service require an explicit auth mode outside development |

## Later

- Use Azure Web PubSub for horizontally scaled real-time updates on the admin Monitoring page (lets the API run more than one replica).
- Add per-rule failure tolerances and optional partial delivery/quarantine of valid rows.
- An "unauthorized" page for non-admin deep links into `/admin`.

## Environment-dependent acceptance and intentional limits

These are not defects, but need evidence or an owner decision before production: Service Bus keeps a public Entra-only endpoint (NAT or Premium Private Link if
policy changes); the API stays at one replica until cross-replica sockets are proven; worker job capacity, lock renewal and empty-queue exits need live
verification; OIDC deployment and final images are not exercised in CI; the Linux SQL driver needs a container runtime gate; natural-language assurance (example
policy, evaluation corpus, cost and latency budgets, privacy) remains an owner decision; whole-upload pass/fail, warning behaviour, ignored sheets and
no-target uploads finishing as `VALIDATED` are documented product choices.
