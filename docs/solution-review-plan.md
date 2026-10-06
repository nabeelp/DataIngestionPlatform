# Data Ingestion Platform: consolidated solution review

Review date: 2026-10-05. Reviewed revision: `368ca2c`
(`WP11: Fix natural language rule creation`).

This document consolidates the earlier follow-up plan and the current
whole-repository review. It records findings and proposed work, not completed
fixes. Application code, infrastructure, and other documentation are unchanged.

## Executive assessment

The solution has a substantial implementation: a React administration/upload
experience, versioned definition contracts, asynchronous Python/Polars
validation, structured rule configurations, restricted SQL for natural-language
rules, Blob storage, Service Bus, and Azure deployment assets.

It is not yet ready to be treated as a production-complete ingestion service.
The most important gaps are correctness and recovery, not cosmetic polish:

- Some changes to validation behavior are invisible to publishing.
- Some valid files fail, and some invalid files pass, because parsing, rules,
  workbook coverage, and cached previews disagree.
- Deletion does not consistently preserve history or remove customer data.
- Retries and queue handoffs can leave inconsistent or falsely completed work.
- The Azure deployment path has configuration/bootstrap blockers, and primary
  UI journeys have authentication, data-entry, and keyboard-access defects.
- The implemented delivery destination is container-local, not durable Azure
  delivery.
- Session revocation, audit completeness, and release evidence are insufficient
  for broader customer-data use.

These conclusions distinguish source-confirmed behavior from checks performed
against a running system. Passing unit tests do not establish end-to-end,
performance, security, or deployment acceptance.

## Scope, evidence, and priorities

Scope: frontend journeys, API/services, authentication, SQL schema and models,
Python validation/parsing, shared contracts, samples, infrastructure, local
startup, CI/deployment workflows, and repository documentation.

Evidence labels:

- **Reproduced:** executed the actual code path with local fixtures or isolated
  mocks; the reproduction's boundary is stated.
- **Source-confirmed:** implementation and its caller/schema establish the
  gap; a live integration reproduction was not performed.
- **Readiness gap:** a missing operational capability or owner decision, not
  proof that every deployment fails.
- **Documentation drift:** a documented claim differs from current behavior.

Priorities are delivery priorities, not vulnerability scores:

- **P0:** resolve the architecture/rollout gate before promising the capability.
- **P1:** correct before broader customer-data or production use.
- **P2:** required hardening, functional completion, or documentation work.
- **P3:** optimization after correctness and reliability.

Ownership below names the responsible area, not an assigned individual. Every
finding is open unless explicitly described as a limitation or historical item.

## Validation performed

| Area | Check | Result and qualification |
|---|---|---|
| Backend | `npm test -- --runInBand --silent` | 17 suites passed, 3 skipped; 106 tests passed, 26 skipped. Database integration was deliberately not enabled. |
| Backend | `npm run lint` | Passed with 23 warnings and no errors. |
| Backend | `npm run typecheck` | Passed. |
| Frontend | `npm test -- --no-cache --reporter=dot` | 12 files, 64 tests passed; no failed or skipped tests. |
| Frontend | Type checking and ESLint | Type check passed; lint reported 0 errors and 12 warnings. |
| Frontend | In-memory Vite production build, `build.write=false` | Passed; main JS 910,320 bytes minified / 259,888 bytes gzip. No generated contracts or production assets were rewritten. This invocation did not itself print a chunk-size warning. |
| Frontend interactions | Actual handlers/effects with isolated state/response mocks | Reproduced separator loss during typing, clone reset, and stale rule-list responses. These were not mounted browser E2E runs. |
| Python | Ruff and strict mypy | Passed; mypy checked 46 source files. A Windows null-cache tooling error was resolved by using non-SQLite, nonincremental checking. |
| Python | Ordinary pytest suite with session-local temporary fixtures | **230 passed, 1 skipped**, 35.18 seconds. Only the local SQL/Service Bus integration was disabled. This supersedes an initial restrictive review-harness run of 185 passed/46 skipped. Temporary artifacts were removed. |
| Python | Engine/contract/export probes, existing workbook, real query subprocess | Reproduced localized aggregate false passes, native Excel date failures, decimal precision errors, preview metadata loss, later-sheet query omission, contract inconsistencies, and unsafe CSV cells; boundaries are stated in the findings. |
| Infrastructure | Installed Bicep 0.47.16, template and parameter compilation to stdout | Both passed. Compilation does not validate role existence, deployment order at runtime, networking, or application readiness. |
| Local/deployment assets | Five PowerShell syntax parses; workflow/azd YAML, emulator JSON and Compose configuration | Passed. Scripts were not executed; no images or containers were started. |
| Azure reference checks | Microsoft Learn built-in role catalog/IP filtering; KEDA scaler specification | Verified the receiver-role catalog mismatch and documented scaler namespace contract. No live role assignment or scaler was exercised. |
| Version diff | Actual mapping/diff helpers, in-memory contracts | Changes to table controls, encoding, nullable-column presence, lookup values, and a `pattern` rule parameter returned `hasChanges: false`. |
| Delivery | Actual delivery worker/completion path, mocked persistence/storage | A stale request with no delivery records changed a validating upload to `DELIVERED`, with an empty destination. No real file or database was touched. |
| Integration-test currency | Actual rule service, mocked access check | The legacy DTO still used by a skipped integration helper fails with `RuleConfig is required`. |

No billable resources were provisioned or modified. No live customer database,
real queue, or real model request was used for these reproductions. Azure
revision replacement, recovery/restore, browser E2E, and production-host
performance require separate acceptance evidence.

Eight ordinary frontend E2E cases and one sample-corpus test were **not run**.
The checked-in contract generators and container-image builds were not exercised.
Unit/build results validate the reviewed source and declarations, not fresh
deployment, generated-file currency, Linux image completeness, or an SLO.

## Findings register

| ID | Priority | Finding | Evidence | Owner area |
|---|---|---|---|---|
| OPS-01 | P0 | Delivery is not durable in Azure | Source-confirmed / readiness | Delivery and infrastructure |
| FUN-01 | P1 | Full-contract changes disappear from version publishing | Reproduced | API and contracts |
| FUN-02 | P1 | Definition deletion can fail after removing user access | Source-confirmed | API and database |
| FUN-03 | P1 | Upload deletion leaves related customer-data records | Source-confirmed | API, database, storage |
| FUN-04 | P1 | Stale delivery requests can falsely complete a new attempt | Reproduced | Messaging and delivery |
| FUN-05 | P1 | Database-to-queue handoffs are not crash-recoverable | Source-confirmed | Messaging and operations |
| AUTH-01 | P1 | Sessions are not revoked when account authority changes | Source-confirmed / readiness | Identity and frontend |
| AUTH-02 | P1 | Production administrator bootstrap/recovery is incomplete | Source-confirmed / scope decision | Identity and operations |
| VAL-01 | P1 | Declared numeric/date semantics disagree across validation paths | Reproduced | Validation engine |
| VAL-02 | P1 | Cached Parquet previews lose source failures and table identity | Reproduced | Parsing and preview |
| VAL-03 | P1 | Single-layout query rules omit later workbook sheets | Reproduced through real query subprocess | Validation engine |
| EXP-01 | P1 | Spreadsheet exports lack formula-safe presentation | Reproduced / source-confirmed | Reports and frontend |
| UI-01 | P1 | Failed login and expired-session recovery are unreliable | Source-confirmed | Frontend identity |
| UI-02 | P1 | Controlled text fields corrupt multi-value typing | Reproduced | Rule/definition editors |
| UI-03 | P1 | Primary upload/definition controls are not keyboard-operable | Source-confirmed | Frontend accessibility |
| OPS-02 | P1 | Azure frontend receives incorrect API/socket configuration | Cross-layer source-confirmed | Deployment and frontend |
| OPS-03 | P1 | Clean provisioning has image and SQL dependency gaps | Source/compiled-template confirmed | Infrastructure |
| OPS-04 | P1 | Receiver role ID differs from the official built-in role | Source and official catalog | Infrastructure identity |
| OPS-05 | P1 | Private SQL administration lacks a documented network path | Source-confirmed prerequisite gap | Deployment and operations |
| OPS-10 | P1 | Scaler namespace differs from the documented KEDA contract | Source/documentation mismatch; managed runtime untested | Infrastructure and messaging |
| FUN-06 | P2 | Deleting a referenced lookup breaks draft-dependent reads | Source-confirmed | Rules and lookups |
| FUN-07 | P2 | Inactive definitions are not blocked at upload admission | Source-confirmed | API and frontend |
| GOV-01 | P2 | Audit coverage and audit/write atomicity are incomplete | Source-confirmed | Governance and API |
| API-01 | P2 | API validation, errors, and duplicate CRUD contracts diverge | Source-confirmed | API |
| VAL-04 | P2 | Authoring/publication contract checks are inconsistent | Reproduced; reachability qualified | Contracts and validation API |
| VAL-05 | P2 | Issue counts and sheet/column locations can be misleading | Reproduced | Validation diagnostics |
| VAL-06 | P2 | Encoding decisions mishandle explicit settings and sample boundaries | Reproduced decision functions | File readers |
| UI-04 | P2 | Clone, selection, and example state can diverge from user intent | Reproduced / source-confirmed | Frontend rule editor |
| UI-05 | P2 | Lists/search/reference values are incomplete beyond first pages | Source-confirmed | Frontend discovery |
| UI-06 | P2 | Failures and reconnects do not consistently reconcile UI state | Cross-layer source-confirmed | Frontend and realtime |
| DATA-01 | P2 | Data lifecycle is not defined end to end | Readiness | Data owner and operations |
| OPS-06 | P2 | Releases do not coordinate worker, schema, and rollback | Source-confirmed | Release engineering |
| OPS-07 | P2 | SQL identity recreation is not reconciled | Source-confirmed | Operations identity |
| OPS-08 | P2 | Readiness, outcome monitoring, and recovery need completion | Source-confirmed / readiness | Operations |
| OPS-09 | P2 | Worker secret access is broader than its stated requirement | Source-confirmed / design decision | Identity and infrastructure |
| PERF-01 | P2 | Dense-error memory/performance acceptance is unproven | Source-confirmed materialization / readiness | Validation and performance |
| QA-01 | P2 | Green unit tests do not establish integration readiness | Reproduced / readiness | Quality and CI |
| DOC-01 | P2 | Current, historical, and intended behavior are conflated | Documentation drift | Documentation and owners |
| LOCAL-01 | P3 | Launcher preflight and configured rules-service ports diverge | Source-confirmed | Local development |
| PERF-02 | P3 | Initial frontend bundle eagerly includes all major routes | Measured in-memory build | Frontend performance |

## Correctness and functionality

### FUN-01 - Publish and version history use a lossy contract representation

**Priority/evidence:** P1; reproduced with actual helpers in memory.

**Evidence:** [contractMapper.ts](../Back-End/src/models/contractMapper.ts),
especially `legacyRuleExpression` and `legacySnapshotFromContract`;
[DefinitionContract.ts](../Back-End/src/services/validation/DefinitionContract.ts),
`ruleBehaviour` and `diffContracts`;
[DefinitionVersion.service.ts](../Back-End/src/services/DefinitionVersion.service.ts),
`readDraft`, `getVersionStates`, and `publishDraft`;
[fileDefinitionAdmin.controller.ts](../Back-End/src/controllers/fileDefinitionAdmin.controller.ts),
`mapVersion`.

**Gap and impact:** Draft comparison drops table/header/row-count controls,
encoding, lookup contents, independent column-presence/nullability settings,
and much of the rule parameter configuration. Most advanced rule types reduce
to an empty legacy expression; natural-language rules reduce to their request,
not their complete SQL configuration. These edits can produce no unpublished
change indicator and HTTP 409 when publishing. Changing an unrelated name may
make the change publishable, which is not a valid workaround. Version-history
responses also omit configuration needed to review the actual behavior.

**Follow-up:** Compare canonical full versioned contracts, define which
metadata-only edits should publish, and expose complete version details.
Keep operational metadata explicitly outside the version boundary. Update the
legacy summaries in [DefinitionVersionsModal.tsx](../Front-End/src/pages/admin/DefinitionVersionsModal.tsx)
and [Definitions.tsx](../Front-End/src/pages/Definitions.tsx) so administrators
and uploaders can inspect the effective contract, not just a partial view.

**Acceptance:** Parameterized tests cover every rule type, lookup-only edits,
SQL-only edits, encoding, header row, extra columns, row limits, and independent
`mustExist`/`nullable` changes. Each behavioral edit produces an accurate diff
and new version; previous uploads still validate against their pinned version.

### FUN-02 - Definition deletion conflicts with history preservation

**Priority/evidence:** P1; source-confirmed SQL/model mismatch, not run against
a live database.

**Evidence:** [005_file_definition_versions.sql](../Back-End/database/005_file_definition_versions.sql),
the definition-to-version cascading foreign key and restrictive upload-to-version
foreign key; [FileDefinition.model.ts](../Back-End/src/models/FileDefinition.model.ts),
`delete`; [FileDefinitionVersion.model.ts](../Back-End/src/models/FileDefinitionVersion.model.ts),
`deleteUnreferenced`.

**Gap and impact:** Deletion first commits removal of user assignments, then
tries to delete the definition. A pinned upload prevents the cascading version
delete, so the operation fails after access has already been removed.
`deleteUnreferenced` runs too late to prevent this. For unused definitions,
rule rows and template assets also lack a complete cleanup path. The README's
claim that deleting a definition keeps referenced versions is not implemented
by this schema/model combination.

**Follow-up:** Choose archive, explicit rejection, or a transactional deletion
model that preserves referenced history. Make the UI and documentation state
that policy; do not simply remove the protective foreign key.

**Acceptance:** Disposable-SQL tests cover definitions with and without uploads,
rules, templates, and assignments. Failure leaves access unchanged; retained
uploads retain readable version history and supported retry behavior.

### FUN-03 - Upload deletion does not cascade as claimed

**Priority/evidence:** P1; source-confirmed.

**Evidence:** [Upload.model.ts](../Back-End/src/models/Upload.model.ts), `delete`;
[004_uploads.sql](../Back-End/database/004_uploads.sql), child-table definitions;
[upload.controller.ts](../Back-End/src/controllers/upload.controller.ts),
`deleteUpload`.

**Gap and impact:** Only access rows and the upload row are deleted in SQL.
Validation results, issue samples, sheets, delivery records, and task rows have
no corresponding cascading foreign keys in the current schema. The controller's
cascade assumption is therefore false. It deletes raw/report blobs but not all
staging or delivery artifacts. A later SQL/storage failure can leave a surviving
record whose source has already been removed. This is a current deletion defect,
separate from choosing a retention policy.

**Follow-up:** Implement transactional relational cleanup and recoverable,
idempotent cross-store deletion, with a clear policy for retained audit evidence,
delivered copies, active jobs, and pinned versions.

**Acceptance:** Deleting an eligible fixture removes every intended child row
and artifact; preserved categories are explicitly documented. Inject failure
between storage and database steps, retry cleanup, and prove that no customer
issue values remain unintentionally orphaned.

### FUN-04 - Delivery attempts are not isolated from retries

**Priority/evidence:** P1; reproduced with mocked database/storage around the
actual worker and completion method.

**Evidence:** [DeliveryWorker.service.ts](../Back-End/src/services/DeliveryWorker.service.ts),
`processDeliveryRequest`; [Upload.service.ts](../Back-End/src/services/Upload.service.ts),
`startValidation` and `completeDelivery`;
[upload.controller.ts](../Back-End/src/controllers/upload.controller.ts),
`retryValidation`; [ServiceBus.service.ts](../Back-End/src/services/ServiceBus.service.ts),
delivery message construction.

**Gap and impact:** A validation retry clears old delivery records, but already
scheduled delivery messages are not tied to a persisted generation. The worker
does not require a matching current delivery state. No pending records leads
to completion, and `every` on an empty record set succeeds. An old message can
therefore mark a newly validating upload `DELIVERED` without any delivered
destination. Concurrent messages also lack an atomic target claim and write
directly to the final destination.

**Follow-up:** Carry persisted attempt identity through requests, events and
results; use atomic state/target claims; ignore stale work; require evidence of
all expected targets before completion. Finalize outputs atomically.

**Acceptance:** Delayed messages from attempt N cannot change attempt N+1.
Duplicate/concurrent delivery and simultaneous retries have one logical outcome.
Empty or missing target records never prove delivery. Inject interruption during
copy and verify downstream consumers never receive a partial final file.

**Cross-layer extension:** The Python worker also lacks a persisted attempt
guard: [sql.py](../Validation-Service/src/dq_engine/persist/sql.py#L117) validates
blob/version identity but unconditionally starts and replaces results by upload
ID; [servicebus.py](../Validation-Service/src/dq_engine/messaging/servicebus.py#L155)
overwrites report/Parquet paths shared by attempts. Event bodies have no generation,
and event message IDs are not deterministic. A delayed worker or failure event
can regress a newer attempt, even after delivery. Transactional result replacement
prevents partial SQL writes within one invocation, not stale invocation ownership.

Failure persistence also retains prior report/staging metadata
([sql.py](../Validation-Service/src/dq_engine/persist/sql.py#L344)); report download
checks for a stored link, not its attempt. Fence results and artifact pointers,
isolate attempt outputs, and label or invalidate historical artifacts. Reordering
start/failure/completion/settlement from two attempts must leave exactly one
coherent current result and no silently reused obsolete report or preview.

### FUN-05 - Queue handoff can strand processing after a crash

**Priority/evidence:** P1; source-confirmed failure windows, no crash injection
against a deployed stack.

**Evidence:** [Upload.service.ts](../Back-End/src/services/Upload.service.ts),
`startValidation`, `startDelivery`, and the uncalled `handleTimeoutFailure`;
[ServiceBus.service.ts](../Back-End/src/services/ServiceBus.service.ts).

**Gap and impact:** Validation is marked in progress before its request is
sent. Delivery claims an in-progress state before its records/message are
durable. A process failure between those steps bypasses exception rollback.
Replaying the validation completion can then fail the delivery status claim
without recreating the missing request. There is no active reconciliation loop
behind the timeout helper. A job can remain in progress with nothing processing it.

**Follow-up:** Add a transactional outbox or equivalent recoverable handoff,
idempotent processing, stale-work reconciliation, and an explicit dead-letter
inspection/redrive procedure.

**Acceptance:** Terminate the process at each database/message boundary in a
disposable stack. Every accepted upload eventually finishes or exposes an
actionable failure, without manual database editing or duplicate delivery.

The Python side has the same commit/event gap:
[servicebus.py](../Validation-Service/src/dq_engine/messaging/servicebus.py#L175)
commits results before sending completion. Generic errors are abandoned without
terminal-state reconciliation on retry exhaustion (lines 288-294). The supplied
validation queue dead-letters after three deliveries
([messaging.bicep](../infra/modules/messaging.bicep#L27)); that does not update SQL.
A bounded worker execution can exit zero after abandoning a message, so ACA
execution success is not proof of validation success. Test broker redelivery,
completion publication, exhausted retries and dead-letter recovery together.

### FUN-06 - Lookup deletion can break the definition list

**Priority/evidence:** P2; source-confirmed.

**Evidence:** [Lookup.model.ts](../Back-End/src/models/Lookup.model.ts), `delete`;
[DefinitionVersion.service.ts](../Back-End/src/services/DefinitionVersion.service.ts),
missing-lookup handling in `readDraft` and list-wide `getVersionStates`;
[Rule.service.ts](../Back-End/src/services/Rule.service.ts), `getPublishedRules`.

**Gap and impact:** Lookup deletion does not check draft rule references.
Subsequent draft reads throw for the missing lookup. Since the admin definition
list reads every draft, one deleted referenced lookup can break the entire list.
Published-rule reads unnecessarily depend on draft validity even when their
published lookup snapshot is intact. Lookup-only edits also encounter FUN-01.

**Follow-up:** Prevent or explicitly resolve referenced deletions, display
dependencies, and keep published readers independent of invalid drafts.
Return actionable per-definition draft errors rather than a list-wide failure.

**Acceptance:** A referenced lookup cannot silently invalidate definitions;
one invalid draft does not hide unrelated definitions or published rules.
Historical uploads continue using the snapshotted lookup values.

**Related authoring gap:** [Rules.tsx](../Front-End/src/pages/Rules.tsx#L342)
offers only lookups already present in the definition contract; a new definition
starts with none, and global lookup IDs are not discoverable in the lookup UI.
The backend validates a proposed rule against `getDraftContract` before the
new rule contributes its lookup reference. Python requires that ID already
exist in `contract.lookups` ([lookup.py](../Validation-Service/src/dq_engine/rules/lookup.py#L8)).
Provide a real global-lookup selection/resolution/snapshot path. Acceptance must
create, select, publish and execute the first lookup rule on a fresh definition
entirely through supported UI/API flows, without database editing.

### FUN-07 - Inactive status does not enforce upload admission

**Priority/evidence:** P2; source-confirmed at the API.

**Evidence:** [FileDefinition.model.ts](../Back-End/src/models/FileDefinition.model.ts),
`findForUser` and `hasAccess`;
[upload.controller.ts](../Back-End/src/controllers/upload.controller.ts),
`uploadFile`.

**Gap and impact:** Admission checks access and layout, but never require
`Status = Active`. Deactivating a definition does not stop API submissions.
The upload selector also does not filter/disable inactive definitions
([Upload.tsx](../Front-End/src/pages/Upload.tsx#L433)).

**Follow-up:** Define whether inactive status blocks only new work or also
retries, enforce that policy server-side, and make selection/disablement clear.

**Acceptance:** Test active, inactive, missing, and concurrently deactivated
definitions. Disallowed uploads leave no persistent file/record; history
remains accessible according to policy.

## Validation semantics and diagnostics

### VAL-01 - Column types and rules do not share parsing semantics

**Priority/evidence:** P1; reproduced on synthetic frames and an existing XLSX.

**Evidence:** [engine.py](../Validation-Service/src/dq_engine/engine.py#L380)
for column formats/precision; [base.py](../Validation-Service/src/dq_engine/rules/base.py#L65)
for default numeric/date parsing; [aggregate.py](../Validation-Service/src/dq_engine/rules/aggregate.py#L11),
[range.py](../Validation-Service/src/dq_engine/rules/range.py#L11),
[date_range.py](../Validation-Service/src/dq_engine/rules/date_range.py#L46), and
[excel_reader.py](../Validation-Service/src/dq_engine/io/excel_reader.py#L81).

**Gap and impact:**

- A decimal column accepts localized `1.234,56`, but an aggregate reparses it
  using default separators, obtains null, and can incorrectly pass a sum limit.
  Range/compare/reconcile share inconsistent numeric parsing. A column-valid
  `dd/MM/yyyy` value can fail `dateRange`.
- Native Excel dates are converted to strings such as `1956-05-25 00:00:00`;
  declaring `date`, or a custom date text format, rejects otherwise valid native
  dates. The existing customer workbook reproduced 50 date issues.
- Precision/scale checks count textual digits rather than normalized decimal
  value. Under precision 5/scale 2, `1234` and `1e10` passed, contrary to the
  documented standard DECIMAL semantics.

**Follow-up:** Centralize declared-column parsing for every rule; preserve or
normalize native workbook types without accidentally relaxing text validation.
Define exact decimal and invalid-aggregate-input semantics without relying on
floating-point spelling/rounding.

**Acceptance:** Equivalent localized/ISO values produce identical outcomes.
`1.234,56` fails sum max 1000 but passes range max 2000. Native Excel dates pass
supported date declarations while invalid text dates fail. DECIMAL(5,2) accepts
999.99 and rejects 1000, 1234 and 1e10; exponent/locale variants have explicit tests.

### VAL-02 - Cached previews are not equivalent to the source file

**Priority/evidence:** P1; reproduced with real validation/read helpers and
in-memory replacement of Parquet reads.

**Evidence:** [engine.py](../Validation-Service/src/dq_engine/engine.py#L966),
[parquet_reader.py](../Validation-Service/src/dq_engine/io/parquet_reader.py#L11),
and [app.py](../Validation-Service/src/dq_engine/api/app.py#L215).

**Gap and impact:** Staging retains cleaned frames, not all structural findings,
original headers/sheet identity, or physical row mappings. Dry run regenerates
rows and pairs files with draft tables by ordinal position. A structurally
failed source can preview as passed; physical row 8 can become row 2.
Reordering draft tables with the same count can apply rules to the wrong sheet.

**Follow-up:** Persist a staging manifest with source identity, parse policy,
structural findings and row maps. Match stable table identities, not positions;
reparse raw files when parsing-affecting settings change or metadata is missing.

**Acceptance:** Raw and cached validation agree on outcome, counts, sheet and
physical row across ragged/multiline CSV, blank rows, duplicate headers, title
rows and missing sheets. Reordering tables cannot swap data; changing header
or ignored-sheet settings invalidates/rebuilds the appropriate cached parse.

### VAL-03 - Single-layout workbook queries only see the first sheet

**Priority/evidence:** P1; source-confirmed and reproduced through the real query
subprocess using publish-accepted scalar/message SQL without internal row access.
The query passed the workbook with a negative amount on sheet two and failed
when the same negative amount was moved to sheet one. Real upload/queue transport
was not exercised.

**Evidence:** [excel_reader.py](../Validation-Service/src/dq_engine/io/excel_reader.py#L125)
selects workbook sheets, while [engine.py](../Validation-Service/src/dq_engine/engine.py#L184)
registers only the first parsed frame for a single-layout query's `t_0`.
The per-sheet column/row-rule loop instead processes each parsed table.

**Gap and impact:** A query check can pass a workbook whose first sheet is valid
and a later sheet violates the condition. This contradicts the single-layout
promise that the definition applies to every included sheet.

**Follow-up:** Define whether such queries run per sheet or on a deliberate
combined table retaining source-sheet identity. Never silently choose sheet one.

**Acceptance:** The same violation fails in the first, middle and last included
sheet, with correct diagnostics. Empty, hidden and ignored-sheet behavior
remains explicit and covered.

### VAL-04 - Contract validation differs between authoring and execution

**Priority/evidence:** P2; reproduced at the validation-service boundary.
Malformed direct service payloads are not assumed reachable through every UI path.

**Evidence:** [validation.py](../Validation-Service/src/dq_engine/api/validation.py#L99),
[models.py](../Validation-Service/src/dq_engine/contracts/models.py#L113),
[definition-contract.schema.json](../contracts/definition-contract.schema.json),
[rule-config.schema.json](../contracts/rule-config.schema.json),
and [engine.py](../Validation-Service/src/dq_engine/engine.py#L575).

**Gap and impact:**

- Duplicate rule IDs are accepted and share an internal expression alias; a
  later rule can replace an earlier failure mask. A single-layout contract can
  contain multiple tables although CSV processing uses only the first.
- A range without either bound is accepted during authoring but rejected during
  publication. Some request ID/date constraints differ between schema and model.
  Nonboolean natural-language `failWhen="1"` can raise an unstructured engine
  typing error instead of a useful configuration rejection.
- Natural-language column declarations can authorize themselves rather than
  being checked strictly against definition columns. A typo can publish and
  fail only at upload time. Empty example lists are allowed.

The last two natural-language policies need a decision: current tests intentionally
permit additional rule-only columns, and the schema intentionally permits empty
examples. They are assurance/documentation gaps unless strict membership and
positive/negative examples are chosen as requirements. Independent single-row
examples also do not prove multirow uniqueness or full cross-sheet query semantics.

**Follow-up:** Align schema, model, cross-field and combined-plan validation;
require Boolean predicates; explicitly define extra-column and example policies.
Validate IDs/cardinality before compiling and avoid using untrusted identifiers
as unvalidated internal column keys.

**Acceptance:** Invalid IDs/cardinality/bounds/types reject with field-specific
errors at authoring and publish. Normalized rules remain schema-valid. Duplicate
metadata cannot suppress a rule. Test row/query and single/sheet layouts, and
include whole-dataset examples when claiming aggregate/cross-sheet assurance.

### VAL-05 - Issue counts and source locations lose actionable information

**Priority/evidence:** P2; reproduced.

**Evidence:** [required.py](../Validation-Service/src/dq_engine/rules/required.py#L10),
[engine.py](../Validation-Service/src/dq_engine/engine.py#L329),
query-result conversion at lines 230-254, and
[sql.py](../Validation-Service/src/dq_engine/persist/sql.py#L305).

**Gap and impact:** A multi-column required rule collapses missing cells to one
row-level issue. Two empty cells produced count 1 and
`Required value missing for "None"`, instead of identifying both columns.
Cross-sheet query conversion can map a returned table to a physical row and
then discard the table identity, leaving a row number with no sheet in SQL/report
diagnostics. File-level query failures should remain distinct from row-level ones.

**Follow-up:** Implement documented cell-level required counts and carry per-issue
sheet/column identity through engine, SQL, API, UI and CSV.

**Acceptance:** Two missing cells produce two correctly named issues. Failures
on row 8 in two different sheets remain distinguishable end to end. Exact totals
and the first-100 samples agree; genuinely file-level issues invent no row.

### VAL-06 - Encoding sniffing can override explicit configuration incorrectly

**Priority/evidence:** P2; reproduced decision functions, not a large on-disk
boundary fixture.

**Evidence:** [sniff.py](../Validation-Service/src/dq_engine/io/sniff.py#L17)
samples 64 KiB and tries UTF-8 before applying the configured fallback.

**Gap and impact:** A legacy-encoded file with an ASCII prefix can be classified
as UTF-8 despite explicit configuration, then fail on later non-ASCII data.
A valid multibyte UTF-8 character split at the sample boundary can be classified
as Windows-1252. Both data corruption and false rejection need prevention.

**Follow-up:** Define whether explicit non-auto encoding is authoritative;
decode sample prefixes without mistaking an incomplete final character for
invalid whole-file encoding.

**Acceptance:** Boundary fixtures preserve Unicode under auto and explicit
settings. Test legacy high bytes after 64 KiB and UTF-8 characters crossing
that boundary; contradictory settings fail diagnostically rather than silently
changing parsing policy.

### EXP-01 - All spreadsheet exports need formula-safe presentation

**Priority/evidence:** P1; existing finding revalidated. Actual Python export
was captured in memory; no spreadsheet formula was executed.

**Evidence:** [engine.py](../Validation-Service/src/dq_engine/engine.py#L978)
passes issue fields directly to `csv.writer`;
[Compliance.tsx](../Front-End/src/pages/admin/Compliance.tsx#L39) also exports
CSV with quoting rather than a shared spreadsheet-safe encoding policy.

**Gap and impact:** Untrusted values, names and messages beginning with formula
characters remain unchanged in CSV. Quoting delimiters is not formula
neutralization. The policy must cover both server issue reports and client
compliance exports, not just one upload-value field.

**Follow-up:** Apply one documented presentation policy to all user-controlled
fields. Preserve original validation values separately where required and state
report truncation/format behavior.

**Acceptance:** Tests include `=`, `+`, `-`, `@`, leading whitespace/control
characters, quotes, commas and newlines. Isolated import into supported spreadsheet
software treats the cells as text; other report consumers understand the encoding.

## Frontend journeys and accessibility

### UI-01 - Authentication loading and failure recovery conflict

**Priority/evidence:** P1; source-confirmed React lifecycle/control flow,
not a browser login test.

**Evidence:** [AuthContext.tsx](../Front-End/src/context/AuthContext.tsx#L166),
[App.tsx](../Front-End/src/App.tsx#L49),
[Login.tsx](../Front-End/src/pages/Login.tsx#L110), and
[http.ts](../Front-End/src/services/http.ts#L7).

**Gap and impact:** A pending password login triggers global loading that
unmounts the login screen, discarding its eventual error state. A stored
three-part expired token can leave the UI believing it is authenticated while
requests fail; there is no coordinated 401/session recovery.

**Follow-up:** Separate initial session hydration from login submission.
Coordinate authoritative session expiry/revocation handling with AUTH-01,
preserving actionable errors and safe navigation.

**Acceptance:** Delayed invalid-password, locked-account and network failures
remain visible and retryable. Expired sessions return to usable login once,
without loops or wrong-role navigation.

### UI-02 - Normal typing destroys multi-value input

**Priority/evidence:** P1; reproduced using actual controlled-field handlers.

**Evidence:** [RuleConfigFields.tsx](../Front-End/src/pages/RuleConfigFields.tsx#L161),
[ColumnsEditor.tsx](../Front-End/src/pages/admin/ColumnsEditor.tsx#L38), and
[FileDefinitions.tsx](../Front-End/src/pages/admin/FileDefinitions.tsx#L886).

**Gap and impact:** Parsing/trimming/rejoining on every keystroke removes trailing
separators before the next value can be typed. Sequential `A,B` became `["AB"]`;
`Active,Inactive` became `["ActiveInactive"]`. Similar immediate normalization
affects format/ignored-sheet lists. Pasting a completed list is not an adequate
substitute for ordinary editing.

**Follow-up:** Retain raw editable text until commit, or use accessible token/row
controls, then validate and normalize deliberately.

**Acceptance:** Type, paste, delete and reopen multiple values/formats/sheet lines
without merging or dropping them. Add mounted interaction regressions, not only
serialization tests.

### UI-03 - Keyboard-only users cannot complete primary journeys

**Priority/evidence:** P1; source-confirmed inaccessible markup.

**Evidence:** [Upload.tsx](../Front-End/src/pages/Upload.tsx#L475) has a hidden
file input triggered by a mouse-only container;
[Definitions.tsx](../Front-End/src/pages/Definitions.tsx#L230) uses click-only
definition selection.

**Gap and impact:** Keyboard-only users cannot reliably choose a file or select
every definition using these controls.

**Follow-up:** Use named semantic controls with native keyboard activation,
visible focus, and appropriate focus management.

**Acceptance:** A keyboard-only run using Tab and Enter/Space can choose the file,
select each definition and complete upload. Include automated accessibility checks
and a manual assistive-technology pass; neither was run in this review.

### UI-04 - Editor state can reset or refer to the wrong rule/example

**Priority/evidence:** P2; clone/response-order behavior reproduced; example
state behavior source-confirmed.

**Evidence:** [Rules.tsx](../Front-End/src/pages/Rules.tsx#L192), drawer initialization,
`fetchRules`, and clone handling; [NaturalLanguageExamplesEditor.tsx](../Front-End/src/pages/NaturalLanguageExamplesEditor.tsx#L36).

**Gap and impact:** Opening a cloned Warning/range rule resets it to blank
`columnsPresent` defaults. A slower response for definition A can overwrite
the displayed rules after selection changes to B; actions use displayed IDs.
Index-based example keys retain the wrong local JSON draft after deletion,
and invalid JSON can leave old valid parent state available to run/save.

**Follow-up:** Use one deliberate initialization path, request/context guards,
stable example identities, and validity propagated to run/save actions.

**Acceptance:** Clones preserve all fields; late responses never replace the
current definition's rules. Example deletion preserves the displayed/submitted
record, and invalid JSON blocks execution/save with a clear error.

### UI-05 - Discovery stops at arbitrary first-page limits

**Priority/evidence:** P2; source-confirmed request/render paths.

**Evidence:** [UploadHistory.tsx](../Front-End/src/pages/UploadHistory.tsx#L29)
loads the first 100; [Upload.tsx](../Front-End/src/pages/Upload.tsx#L73) searches
the first 50; [Users.tsx](../Front-End/src/pages/admin/Users.tsx#L23) ignores
server pagination; [Lookups.tsx](../Front-End/src/pages/Lookups.tsx#L152) shows
five values with noninteractive additional-value text.

**Gap and impact:** Older uploads/users and full lookup contents cannot be
reliably browsed or searched, although the screens appear to represent the data set.

**Follow-up:** Wire pagination/totals and correctly scoped search. Add a read-only
lookup expansion/detail view, and the lookup authoring bridge in FUN-06.

**Acceptance:** Browse/search 101 uploads, more than one server page of users,
and all 20 values of a lookup without privileged workarounds.

### UI-06 - Failure and reconnect handling can hide the true state

**Priority/evidence:** P2; cross-layer source-confirmed.

**Evidence:** [Upload.tsx](../Front-End/src/pages/Upload.tsx#L194),
[UploadDetails.tsx](../Front-End/src/pages/UploadDetails.tsx#L80), its failure
labels and reconnect handler, and
[socketServer.ts](../Back-End/src/websocket/socketServer.ts#L66).

**Gap and impact:** Some load failures become empty lists, while upload details
drop the top-level error cause and label delivery failure as validation failure.
After disconnection, resubscription does not request a current snapshot; the
server joins a room without replaying state. A terminal event missed while offline
can leave stale details without polling or a connection warning.

**Follow-up:** Distinguish loading/empty/error states, preserve sanitized
stage-specific causes, and reconcile current state on reconnect/refocus with
bounded retry/fallback behavior.

**Acceptance:** An offline list shows a retryable error, not "no data." A failed
delivery with passed rules identifies delivery and its cause; parse failures
without rule details remain diagnosable. Disconnect across completion, reconnect,
and observe the authoritative terminal state without a manual page reload.

## Identity, governance, and API completion

### AUTH-01 - Account changes do not revoke existing sessions

**Priority/evidence:** P1; source-confirmed, with browser-session architecture
requiring an owner decision.

**Evidence:** [authMiddleware.ts](../Back-End/src/middleware/authMiddleware.ts),
`verifyAccessToken`; [socketServer.ts](../Back-End/src/websocket/socketServer.ts),
handshake authentication; [Auth.service.ts](../Back-End/src/services/Auth.service.ts),
`generateToken`; [auth.routes.ts](../Back-End/src/routes/auth.routes.ts), logout;
[AuthContext.tsx](../Front-End/src/context/AuthContext.tsx), persistent token storage.

**Gap and impact:** HTTP authorization trusts signed token claims without
checking current account activity, role, or session version. Disabling or
demoting a user does not invalidate those claims. Logout returns success
without revocation. WebSocket authentication occurs on connection, without
an expiry/revocation disconnect path. JWT lifetime is hardcoded to 24 hours
despite the configurable expiry setting. The earlier browser bearer-storage
concern remains part of the session design.

Signature/expiry verification and an HS256 algorithm restriction already exist;
this finding must not be described as an absence of token verification.

**Follow-up:** Design revocation and browser-token protection together.
If adopting `HttpOnly`, `Secure`, `SameSite` cookies, include CSRF protection
and migrate login, SSO callback, refresh, HTTP, Socket.IO, logout, and local
development together. Validate claim types and allowed roles.

**Acceptance:** HTTP and already-connected sockets reject expired, revoked,
disabled-user and stale-role sessions. Logout has the documented server-side
effect. No production access token remains in browser persistent storage under
the selected design; configured expiry and refresh behavior are tested.

### AUTH-02 - Recovery and administrator lifecycle need completion

**Priority/evidence:** P1 for clean-production bootstrap; P2 for broader recovery
completion. Source-confirmed capability gap, not a claim that
self-service recovery was promised.

**Evidence:** [auth.routes.ts](../Back-End/src/routes/auth.routes.ts);
[Auth.service.ts](../Back-End/src/services/Auth.service.ts), unused reset-token
helper; [admin.controller.ts](../Back-End/src/controllers/admin.controller.ts),
`updateUser` and `deleteUser`.

**Gap and impact:** Password sign-in exists, but no wired password-change/reset
flow is provided. Admin update cannot reset a password. Update permits
self-disablement/demotion without a last-admin safeguard, although the separate
delete endpoint blocks self-deletion. Recovery depends on out-of-band intervention.
The [Users.tsx](../Front-End/src/pages/admin/Users.tsx) screen also lacks the
creation action despite a create-user API. Cloud schema application does not
seed an application admin: [apply.ps1](../Back-End/database/apply.ps1#L78) seeds
only local mode, while [User.model.ts](../Back-End/src/models/User.model.ts#L54)
defaults new SSO users to `user`. SQL administrator and application administrator
are different roles; the runbook does not bridge this first-use gap.

**Follow-up:** Decide whether production is SSO-only or supports a complete
password lifecycle. Document first-admin bootstrap, emergency recovery,
ownership transfer, and last-admin rules.

**Acceptance:** A clean deployment can establish an authorized administrator.
An operator can recover access using the documented approved path, and ordinary
administration cannot accidentally leave the platform with no usable admin.

### GOV-01 - Audit events do not cover the governance surface

**Priority/evidence:** P2; source-confirmed.

**Evidence:** [AuditLog.model.ts](../Back-End/src/models/AuditLog.model.ts);
[admin.controller.ts](../Back-End/src/controllers/admin.controller.ts);
[fileDefinitionAdmin.controller.ts](../Back-End/src/controllers/fileDefinitionAdmin.controller.ts);
[rule.controller.ts](../Back-End/src/controllers/rule.controller.ts);
[upload.controller.ts](../Back-End/src/controllers/upload.controller.ts);
[definition.controller.ts](../Back-End/src/controllers/definition.controller.ts).

**Gap and impact:** Some admin changes, lookup changes, and publishes are
audited. Rule creation/edit/toggle/regeneration, assignments, template changes,
upload/retry/delete/report operations, and authentication lifecycle do not have
equivalent durable audit coverage. The parallel legacy definition endpoints
also bypass the admin route's audit behavior. Auditing follows the committed
mutation: an audit failure can return an error after a publish actually succeeded.

**Follow-up:** Define an event/actor/retention matrix; use transactional or
outbox-backed audit recording for authoritative writes. Limit sensitive values
in audit details and document integrity/access controls.

**Acceptance:** Every governed action has a durable attributable event.
Failure injection cannot produce an unaudited successful mutation or a misleading
retry outcome. Operational compliance indicators remain explicitly distinct
from regulatory certification.

### API-01 - Input and error contracts are inconsistent

**Priority/evidence:** P2; source-confirmed.

**Evidence:** [upload.controller.ts](../Back-End/src/controllers/upload.controller.ts),
pagination parsing; [admin.controller.ts](../Back-End/src/controllers/admin.controller.ts),
user pagination; [errorHandler.ts](../Back-End/src/middleware/errorHandler.ts);
[RulesService.service.ts](../Back-End/src/services/RulesService.service.ts);
[definition.routes.ts](../Back-End/src/routes/definition.routes.ts);
[admin.routes.ts](../Back-End/src/routes/admin.routes.ts).

**Gap and impact:** Several pagination inputs are parsed without finite,
positive, or maximum bounds, allowing malformed input to become SQL errors
and HTTP 500. The common error handler ignores typed `statusCode` values, so
some downstream validation/unavailability errors lose their intended status.
Legacy PascalCase definition CRUD and newer camelCase/full-contract CRUD have
different validation, capability, and audit behavior.

**Follow-up:** Establish a canonical documented API, bounded shared request
validation, stable error codes, safe messages and correlation IDs. Deprecate
or align duplicate routes rather than leaving two competing contracts.

**Acceptance:** Negative, zero, oversized, malformed, and missing inputs yield
documented 4xx responses; dependency failures preserve appropriate 5xx semantics.
Equivalent supported operations enforce the same contract and audit behavior.

## Delivery and data lifecycle

### OPS-01 - Local file-copy delivery is not durable cloud delivery

**Priority/evidence:** P0 rollout gate when delivery is promised;
source-confirmed/readiness. Validation-only use can finish as `VALIDATED`.

**Original evidence:** [DeliveryTargets.service.ts](../Back-End/src/services/DeliveryTargets.service.ts),
the original `FileCopy` target; [DeliveryWorker.service.ts](../Back-End/src/services/DeliveryWorker.service.ts),
filesystem writes; [appConfig.ts](../Back-End/src/config/appConfig.ts),
`DELIVERY_ROOT_PATH`.

**Gap and impact:** Validated files are copied beneath the API process's local
root. A durable source upload in Blob storage does not make that delivered
copy durable or customer-accessible. Container replacement or separate replicas
cannot be treated as a reliable delivery store. Retry completion records also
do not prove that a copy remains retrievable.

**Resolution implemented:** `DELIVERY_PROVIDER=azure` directs cloud outputs to
the private `deliveries` Blob container; `local` remains the development
default. The existing delivery-folder setting is retained as a relative path
prefix, and deterministic Blob names make retries/replays replace the same
object. The API identity's Blob Data Contributor assignment is container-scoped.
The authenticated delivery-download route checks existing upload access and
only streams outputs recorded as `DELIVERED`; no public URLs or SAS tokens are
issued. Explicit upload deletion removes its delivery artifact. No age-based
expiry is configured; the storage account's seven-day Blob soft-delete recovery
remains in effect. Existing local delivery records and folders are not migrated.
See [README.md](../README.md#delivery) for operator and user behavior.

**Verification:** Targeted backend tests cover Blob delivery, replay handling,
retry scheduling, unsafe paths, authorized downloads, missing/not-ready output,
and access denial. Backend typecheck and Bicep compilation pass.
Deployment-specific acceptance remains pending until a delivered fixture is
retrieved after API/worker restart or revision replacement, and deletion and
authorization behavior are verified in the deployed environment. OPS-01 remains
a rollout gate until that live acceptance evidence is recorded.

### DATA-01 - Retention and deletion lack a complete ownership contract

**Priority/evidence:** P2; readiness gap, with current deletion defects tracked
separately in FUN-02/FUN-03.

**Gap and impact:** A staging lifecycle rule alone does not define retention
for raw uploads, reports, templates, delivered outputs, issue samples, versions,
or audit/database rows. There is no complete guarantee for orphan cleanup,
active/retrying work, preservation requirements, or an operator's deletion request.

**Follow-up:** Agree an artifact-by-artifact policy with the data owner. Define
owner, expiry trigger, retention period, deletion mechanism, active-work
protection, legal-hold/preservation behavior where applicable, and observability.
Make cross-store cleanup retryable rather than assuming one atomic delete.

**Acceptance:** Every artifact category has a documented lifecycle and tested
deletion path. Safe staging tests show expiry without deleting active work.
Failures and orphan cleanup are visible and actionable.

**Evidence:** [data.bicep](../infra/modules/data.bicep#L127)
expires only `staging/` after 30 days. Seven-day blob/container soft delete is
recovery protection, not a raw-upload/report retention policy. Template storage
also needs lifecycle ownership. Expiry based only on age must not invalidate
active work or an explicitly preserved audit/retry dependency.

## Deployment and operational readiness

### OPS-02 - Azure build configuration targets the wrong API/socket locations

**Priority/evidence:** P1; cross-layer source-confirmed.

**Evidence:** [predeploy.ps1](../scripts/predeploy.ps1#L53) injects origin-only
`API_URL` as `VITE_API_URL`; [apps.bicep](../infra/modules/apps.bicep#L612) produces
that origin; [api.ts](../Front-End/src/config/api.ts#L28) uses it verbatim.
[AuthContext.tsx](../Front-End/src/context/AuthContext.tsx#L187) appends
`/auth/login`. No `VITE_WS_URL` is injected; its fallback is the static site's
origin ([api.ts](../Front-End/src/config/api.ts#L59)).

**Gap and impact:** The produced login URL omits the API's `/api/v1` prefix.
Sockets target the Static Web App instead of the Container App. This mismatch
exists independently of any further azd packaging/rebuild behavior.

**Follow-up:** Define one API-base contract and inject both API base and socket
origin in the actual packaging lifecycle. Ensure later packaging cannot replace
the correctly configured bundle.

**Acceptance:** Production configuration tests resolve login to the API origin
plus `/api/v1/auth/login`, and sockets to the API origin. Inspect final packaged
assets and complete login/realtime smoke tests against an approved deployment.

### OPS-03 - Fresh provisioning depends on resources not yet ready

**Priority/evidence:** P1; source/compiled-template-confirmed dependency gaps.
Azure failure manifestation was not induced.

**Evidence:** [apps.bicep](../infra/modules/apps.bicep#L180) references API/rules/
worker images in the new registry;
[registry.bicep](../infra/modules/registry.bicep#L12) creates an empty registry;
[predeploy.ps1](../scripts/predeploy.ps1#L41) builds/pushes images only during
the later deploy hook. [data.bicep](../infra/modules/data.bicep#L240) defines SQL
administrator and Entra-only authentication children without ordering the latter
after the administrator.

**Gap and impact:** The documented provision-then-deploy path requires images
before the supplied image-push step. Separately, Entra-only enabling can race
the administrator prerequisite. A successful Bicep compile or historical preview
does not prove that a fresh environment can bootstrap.

**Follow-up:** Order foundation, images, schema/grants and application activation
explicitly, or provide an intentionally safe bootstrap. Add the missing SQL
administrator dependency.

**Acceptance:** Dependency/lifecycle tests prove ordering. An approved clean
deployment succeeds with no pre-existing images/manual repairs; a rerun is safe.
Do not introduce public SQL access or demo credentials as a bootstrap shortcut.

### OPS-04 - Service Bus receiver role ID is incorrect

**Priority/evidence:** P1; repository value compared with the official catalog
on the review date. No live role lookup/assignment was performed.

**Evidence:** [rbac.bicep](../infra/modules/rbac.bicep#L29) uses
`4f6d3b9b-027b-4f4f-a9f5-4d5bc7e44f8f` for receiving grants.
The [Microsoft Learn role definition](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/integration#azure-service-bus-data-receiver)
identifies Azure Service Bus Data Receiver as
`4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0`.

**Status:** Corrected in Bicep after Azure CLI role-catalog lookup and a live
provisioning failure confirmed the incorrect ID. Revalidation and live
assignment/receive-operation checks remain pending.

**Gap and impact:** The configured ID does not select the documented built-in
role. Bicep accepts arbitrary GUID strings, so successful compilation misses
this deployment/authorization blocker.

**Follow-up:** After provisioning, verify all receiving assignments and test
the approved API/worker receive operations. Do not substitute an invented or
custom role, or broaden to owner privileges to mask the issue.

**Acceptance:** Every receiving assignment resolves to the intended scoped role;
approved API/worker receive operations succeed and unrelated access remains denied.

### OPS-05 - Private SQL migration prerequisites are incomplete

**Priority/evidence:** P1 prerequisite/runbook gap; an independently configured
private runner could already satisfy it.

**Evidence:** [data.bicep](../infra/modules/data.bicep#L228) disables public SQL
access; [network.bicep](../infra/modules/network.bicep#L21) supplies application/
private-endpoint subnets; [postprovision.ps1](../scripts/postprovision.ps1#L19)
invokes local SQL tools; [deployment.md](deployment.md) does not
define an operator VPN/peering/private runner and DNS route.

**Gap and impact:** Management-plane permissions alone cannot let an ordinary
workstation apply schema/grants to private SQL. The runbook also needs to verify
the Go `sqlcmd` implementation, not merely an executable named `sqlcmd`;
the reviewed machine resolves an older ODBC implementation on PATH.

**Follow-up:** Supply an approved private-connected runner, DNS/preflight,
exact tool requirements, database/directory permissions and bootstrap steps
from AUTH-02. Keep SQL private.

**Acceptance:** Preflight fails clearly without the required path/tool/identity.
The approved runner resolves the private address, applies schema/grants and
performs the first-admin smoke journey without undocumented intervention.

### OPS-06 - Worker, schema, and application releases are not coordinated

**Priority/evidence:** P2; source-confirmed lifecycle gap.

**Evidence:** [predeploy.ps1](../scripts/predeploy.ps1#L70) updates the worker job
before service deployment; [azure.yaml](../azure.yaml#L29) migrates only after
provisioning; [azure-deploy.yml](../.github/workflows/azure-deploy.yml#L16)
refreshes/deploys without an explicit migration, serialization, rollback or
required smoke gate.

**Gap and impact:** A failed API/frontend rollout can leave a new worker consuming
messages against older code/schema. Application-only deploys do not install
required schema changes, and overlapping dispatches can interleave versions.

**Follow-up:** Treat the worker as a first-class release artifact. Serialize
releases, gate compatible migrations on the private runner, record image/schema
versions, and define safe drain/pause/rollback behavior.

**Acceptance:** A missing required schema blocks release before traffic.
Failure after worker update restores a compatible release or safely pauses work.
Parallel releases cannot interleave; recovery is rehearsed, not only described.

### OPS-07 - Recreated managed identities leave stale SQL mappings

**Priority/evidence:** P2; source-confirmed.

**Evidence:** [grant-managed-identities.sql](../Back-End/database/grant-managed-identities.sql#L1)
checks whether a user name exists before creation and reapplies roles by name.

**Gap and impact:** A recreated managed identity can retain its resource name
but have a new principal ID. The script can succeed while SQL still maps the
name to the previous identity, leaving the replacement unable to connect.

**Follow-up:** Reconcile the expected SID/object ID as well as grants; repair
deliberately or fail with a diagnostic. Document directory lookup prerequisites
for unattended SQL operators.

**Acceptance:** Recreate identity A as B with the same name against retained SQL;
repeat reconciliation safely, verify B's intended access and rejection of A.

### OPS-08 - Health and successful jobs do not prove service readiness

**Priority/evidence:** P2; source-confirmed/readiness.

**Evidence:** [index.ts](../Back-End/src/index.ts#L54) returns unconditional health;
[apps.bicep](../infra/modules/apps.bicep#L297) uses it for liveness/readiness;
[monitoring.bicep](../infra/modules/monitoring.bicep#L15) creates monitoring
resources without the required outcome/recovery model.
[Stats.service.ts](../Back-End/src/services/Stats.service.ts#L39) derives system
health from recent validation failure rates, returning 100% without uploads.

**Gap and impact:** Dependency failure or stranded/dead-lettered work can coexist
with healthy process probes and successful bounded job executions. Default
process metrics and a dashboard are not end-to-end availability/outcome alerts.
The manual smoke checklist exists, but execution evidence, automation, incident
ownership, replay/restore procedures and measured recovery objectives are missing.

**Follow-up:** Separate liveness, readiness and business outcomes. Instrument
backlog age, event-subscription/queue DLQs, stuck attempts, dependency failures,
latency and delivery outcomes. Define SLO/RPO/RTO, alert owners, redrive safeguards,
identity/secret repair, revision rollback and database/blob restore.

**Acceptance:** Simulated outages fail readiness/smoke without causing a liveness
restart storm. Poison/stuck work alerts and reconciles within a declared time.
Restore/replay meets measured objectives without duplicated delivery. Do not claim
SQL lacks platform backups; prove the supported restore procedure instead.

### OPS-09 - Worker secret permissions exceed the stated requirement

**Priority/evidence:** P2 hardening decision; scope confirmed, access not exercised.

**Evidence:** [rbac.bicep](../infra/modules/rbac.bicep#L149) grants Key Vault Secrets
User at vault scope to both identities; [data.bicep](../infra/modules/data.bicep#L184)
places multiple application secrets in the vault, while the runbook describes
the worker's need in terms of its monitoring secret.

**Gap and impact:** The worker/rules identity can be authorized for unrelated
API secrets, beyond its functional requirement.

**Follow-up:** Explicitly accept the PoC boundary or separate/scope identities
and secrets to the required operations.

**Acceptance:** An approved role review demonstrates required secret resolution
without worker access to unrelated API credentials. No actual secrets belong
in the review, logs, examples, or source control.

### OPS-10 - Scaler configuration conflates namespace name and SDK endpoint

**Priority/evidence:** P1 pre-rollout validation item; source/documentation
mismatch, not a reproduced ACA scaler failure.

**Evidence:** [messaging.bicep](../infra/modules/messaging.bicep#L74) outputs the
namespace FQDN, passed to `metadata.namespace` in
[apps.bicep](../infra/modules/apps.bicep#L535). The
[KEDA 2.18 Service Bus specification](https://keda.sh/docs/2.18/scalers/azure-service-bus/)
defines `namespace` as the namespace **name** and supplies the cloud endpoint
suffix separately.

**Gap and impact:** Reusing the SDK's fully qualified endpoint for the scaler
does not match that contract and may prevent queued work from activating workers.
The exact managed ACA scaler version/behavior was not tested.

**Follow-up:** Separate namespace name from SDK endpoint, verify the managed
scaler contract, and test identity/network access along the activation path.

**Acceptance:** A queued fixture starts the intended job, without relying on
manually started workers. Record effective executions/replicas and lock/settlement
behavior for slow and empty queues; configuration alone does not prove concurrency.

### LOCAL-01 - Rules-service port preflight and health URLs are inconsistent

**Priority/evidence:** P3; source-confirmed.

**Evidence:** [start.ps1](../start.ps1#L191) omits port 8000 from its port checks,
then starts and checks Python at a hardcoded URL; supported environment settings
can differ from that URL.

**Gap and impact:** A port conflict can be discovered only after infrastructure/
schema work, or an unrelated listener can satisfy the weak health check.
A nondefault configured port is not consistently launched/verified.

**Follow-up:** Derive URLs/preflight from effective configuration and verify
the expected process/service. Document the Windows launcher requirement and
non-destructive shutdown of the Docker dependencies it intentionally leaves running.

**Acceptance:** Occupied ports fail before side effects; supported nondefault
ports work consistently. Never terminate an unrelated process to free a port.

## Performance and capacity

### PERF-01 - Dense-error workloads lack bounded-memory acceptance

**Priority/evidence:** P2; source-confirmed materialization and missing measurement,
not a demonstrated out-of-memory failure.

**Evidence:** [engine.py](../Validation-Service/src/dq_engine/engine.py#L665)
materializes failed indices/values and issues before applying some caps;
`report_issues` is accumulated in memory and then exported. Query results are
also materialized before limiting.

**Gap and impact:** Sparse-error/local benchmarks do not establish memory use
for dense failures across many columns. "Streaming" and "full report" wording
can imply stronger guarantees than implemented.

**Follow-up:** Stream/batch failure output or otherwise bound intermediate
materialization. Document the intentional one-million-report-line cap, truncation
marker and 200-character displayed-value limit. Measure parsing/rules/output/SQL
separately on the required 4-vCPU/8-GiB host.

**Acceptance:** At one million rows and 0%, 1%, 50% and 100% failure densities,
exact counts, stable first-100 samples and capped-report semantics hold within
an approved measured RSS/latency budget. Include multiple failing columns,
repetitions and p95. Existing local results and smaller XLSX fixtures are not
silently promoted to the prescribed-host performance gate.

### PERF-02 - Initial frontend load includes the full application

**Priority/evidence:** P3; measured in-memory production bundle.

**Evidence:** [App.tsx](../Front-End/src/App.tsx#L3) eagerly imports admin/chart
and other major routes. Vite produced one main JS chunk of 910,320 bytes
minified, 259,888 bytes gzip.

**Gap and impact:** Login/initial navigation loads functionality not immediately
needed. This corroborates the earlier roughly 910-KB observation; the current
in-memory invocation did not itself emit the earlier chunk warning.

**Follow-up:** Inspect bundle composition and introduce measured route-level
lazy loading or targeted chunking, not arbitrary splits.

**Acceptance:** Compare entry/route sizes and cold-load measurements before/after;
test deep links, authentication and route loading with failure boundaries.
Preserve unit/type/build checks and do not invent a network-latency SLA from size.

## Release evidence and documentation

### QA-01 - Integration coverage is both skipped and partially stale

**Priority/evidence:** P2; reproduced contract mismatch plus missing acceptance
evidence.

**Evidence:** [DefinitionVersioning.integration.test.ts](../Back-End/tests/DefinitionVersioning.integration.test.ts),
the legacy `addRule` helper; [Rule.service.ts](../Back-End/src/services/Rule.service.ts),
`createRule`; [DatabaseSchema.test.ts](../Back-End/tests/DatabaseSchema.test.ts);
[UploadValidationEvents.test.ts](../Back-End/tests/UploadValidationEvents.test.ts).

**Gap and impact:** All three backend database suites were skipped in this
review. At least one helper still calls rule creation without the now-required
`Config`, and an isolated call reproduces its rejection. Source-string SQL
tests do not exercise foreign-key behavior, deletion atomicity, or migrations.
Progress-event unit coverage does not prove retry/duplicate/crash correctness.

**Follow-up:** Update integration fixtures for current contracts and service
prerequisites. Add non-skipping disposable-stack release gates for the highest
risk paths, infrastructure compilation, browser E2E, and deployment smoke tests.
Keep performance-gate evidence distinct from ordinary unit test success.

**Acceptance:** Required checks cover publishing all behavioral fields,
deletion/history, access, report download, duplicate delivery, stale attempts,
and dependency outages. Skips are reported and cannot satisfy a required gate.
Performance results include the prescribed host, fixture generation, limits,
and measured outputs.

**CI evidence:** [ci.yml](../.github/workflows/ci.yml) runs service lint/type/unit/
build jobs, but not the actual SQL/emulator/browser/infrastructure/container
acceptance set. The ordinary Python suite now passes 230 tests, with only its
live integration test skipped; this improves the baseline but does not exercise
the SQL/Service Bus paths. Add negative schema parity, localized rule composition,
Parquet equivalence, workbook queries, dense-error reporting, and mounted UI
interaction regressions for this review's reproductions.

The [deployment runbook](deployment.md) already supplies a manual smoke
checklist. Automate and retain evidence for health/readiness, identities,
schema, queue activation/settlement, storage, login, upload, reports and durable
delivery instead of presenting the checklist's existence as a passed gate.

### DOC-01 - Documentation needs a current-behavior baseline

**Priority/evidence:** P2; documentation drift.

**Evidence:** [README.md](../README.md);
[data-quality-review.md](data-quality-review.md);
[implementation-plan-python-engine.md](implementation-plan-python-engine.md);
[greenfield-data-quality-engine.md](greenfield-data-quality-engine.md);
[deployment.md](deployment.md); [TODO.md](../TODO.md);
[upload.routes.ts](../Back-End/src/routes/upload.routes.ts);
[upload.controller.ts](../Back-End/src/controllers/upload.controller.ts).

**Gap and impact:** Current behavior and historical/intended designs still differ
in several important places:

| Documentation surface | Current finding and required reconciliation |
|---|---|
| Historical review | [data-quality-review.md](data-quality-review.md) **already labels the old Node findings historical**. Preserve that correction; do not reopen all old findings. Link only individually revalidated issues in this register. |
| Architecture/research | [rule-execution-performance.md](rule-execution-performance.md) and [greenfield-data-quality-engine.md](greenfield-data-quality-engine.md) still discuss Node/DuckDB as current/next architecture. Identify superseded decisions and the actual Python/Polars path. |
| Rules ingress | [implementation-plan-python-engine.md](implementation-plan-python-engine.md) says internal-only ingress; [deployment.md](deployment.md) correctly describes the externally reachable, authenticated rules endpoint. Reconcile the plan, not the accurate runbook. |
| Samples and expected outcomes | [samples/README.md](../samples/README.md) and [manifest.json](../samples/manifest.json) retain pre-cutover outcomes, including duplicate-header handling, impossible dates and empty XLSX acceptance. [INTENTIONAL_DIFFERENCES.md](../Validation-Service/tests/golden/INTENTIONAL_DIFFERENCES.md) records different Python outcomes. Current examples/manifest/generators need one consistent oracle across the 109 upload fixtures. Historical Node baselines can remain separately labeled. |
| Rule/definition authoring | README presents legacy expression syntax, while the editor uses typed controls for 15 built-ins. It omits the selectable `date` type and independent presence/nullability/format controls. Update instructions and supported-semantics examples. |
| Cancellation | README promises Stop never saves a rule; the UI acknowledges a completion/cancellation race. State the actual commit boundary and how an uncertain outcome is reconciled. |
| Example data handling | README/controller comments say examples are never stored, but [analyzeExample](../Back-End/src/controllers/fileDefinitionAdmin.controller.ts#L350) uploads a temporary blob before analysis/deletion. Document transient storage and cleanup/error/crash behavior rather than an absolute no-storage claim. |
| Deletion, preview and session settings | Definition deletion/history conflicts with FUN-02. Dry-run comments say pinned version while the controller loads the draft. JWT expiry is hardcoded despite configuration; account lockout uses a threshold of four although configuration/comments say five. |
| Performance/report claims | [Validation-Service/README.md](../Validation-Service/README.md) already qualifies local benchmark host and smaller XLSX results. Preserve those caveats; clarify materialization, one-million-line report cap and displayed-value truncation rather than implying uncapped streaming. |
| Operational/cost guidance | Document the private migration path, application-admin bootstrap, coordinated releases, redrive/restore and actual smoke results. Include the always-on rules replica as well as the API, worker execution, SQL, messaging, storage/logging and optional Foundry cost drivers; avoid unverified fixed cost estimates. |
| Local startup | README's health wording is stronger than the emulator TCP-port checks. State Windows launcher requirements, Go `sqlcmd` requirements, configurable port behavior and non-destructive shutdown of dependencies. |
| Backlog | [TODO.md](../TODO.md) omits many concrete readiness/retention/delivery tasks; the old `Rules.SqlQuery` rename item may be superseded by `Rules.Config`. Map accepted work to IDs here without implying those other files have been updated. |

**Follow-up:** Clearly mark historical/superseded plans, establish a current
architecture/capability matrix, and link the backlog to this register. Document
supported formats/rules, intentional limits, draft versus published behavior,
status transitions, delivery access, authentication/recovery, cleanup, and
operator failure/redrive procedures. Correct contradictions only when the
actual chosen behavior is clear.

**Acceptance:** README, architecture, runbook, backlog, examples, and API
descriptions agree. Each open high-priority finding has an owner-facing next
step, and historical observations are not presented as unverified current defects.
Current sample expected outcomes agree with current engine behavior, including
rejected/read-error distinctions. Users can follow authoring instructions using
controls that actually exist.

## Environment-dependent acceptance questions and intentional limits

These are explicitly not additional runtime-proven defects:

| Area | Required decision or safe validation |
|---|---|
| Service Bus network boundary | [Microsoft Learn](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-ip-filtering) confirms **Standard supports IP filtering**, but the deployed Consumption Container Apps environment returns no outbound IP list. The owner chose public network reachability with Entra-only authentication and RBAC rather than adding NAT Gateway cost. Treat the broader network exposure as accepted for this PoC; use NAT plus static egress IP rules or Premium Private Link if policy later requires network restriction. See [servicebus-network-access.bicep](../infra/modules/servicebus-network-access.bicep). |
| Scaling and realtime | [apps.bicep](../infra/modules/apps.bicep#L174) currently caps the API at one replica, consistent with process-local sockets/cache and a competing-consumer event subscription. Before raising the cap, prove cross-replica cache invalidation, realtime delivery and reconnect recovery. Do not report current multi-replica failure when only one is configured. |
| Reverse-proxy rate limiting | Express does not configure trusted-proxy handling. Validate ACA forwarding semantics so users do not share proxy-address quotas and spoofed forwarding headers cannot bypass limits. Do not blindly trust arbitrary headers. |
| Job capacity and termination | Verify actual managed-job replica/execution cardinality, empty-queue exits, slow messages, shutdown and lock renewal. `parallelism=5` and completion count 1 alone do not prove five concurrent replicas or premature cancellation. Application outcomes must be monitored separately from execution exit status. |
| Deployment tools and artifacts | Verify azd/GitHub OIDC behavior and final frontend rebuild/configuration using the intended runner versions. Current tests did not exercise deployment auth or packaging. |
| Private SQL operator identity | Establish minimum database and Entra directory lookup permissions for the chosen unattended migration principal; management-plane ownership is not sufficient. Rehearse bootstrap and identity repair. |
| Linux SQL driver/image | The `mssql-python` dependency bundles its driver components; not separately installing `msodbcsql18` is **not proof of a missing driver**. Linux image dependency closure/import and runtime SQL access still require a container gate. |
| Natural-language assurance | The SQL allowlist/restricted execution exists and examples reduce risk, but do not prove semantic equivalence. Decide required negative/positive and whole-dataset examples, evaluation corpus, cost/latency budgets, schema/request privacy and retention, and owner review before publishing. No live Foundry quality/cost evaluation was performed. |
| Product boundaries | Whole-upload pass/fail, no partial delivery, Warning behavior, intentionally ignored sheets, case-sensitive columns/case-insensitive sheet matching and no target -> `VALIDATED` are documented choices, not automatically missing features. Preserve them unless an owner approves a change. |
| UI candidate excluded | The absence of `step="any"` alone was not sufficient to prove fractional-number entry failure. Native numeric-input/browser behavior needs a targeted test; it is not counted as a verified defect. |

Existing protections were also observed: development-only auth bypass guards,
SSO signature/audience/issuer/tenant/nonce/PKCE checks, restricted SQL validation,
authenticated report download with explicit errors, immutable upload version pins,
and UI handling of distinct `ERROR` results. These do not close the specific
session, contract, report-content, and retry gaps above.

## Mapping of the previous review

No earlier concern is considered fixed merely because this document is
restructured. The existing groups are retained in the consolidation:

| Previous section | Consolidated treatment |
|---|---|
| Priority 0: durable Azure delivery | OPS-01; retry/idempotency expanded in FUN-04/FUN-05. |
| Priority 1: spreadsheet-safe reports | EXP-01, revalidated and expanded to server issue reports and client compliance CSV. |
| Priority 1: browser token handling/revocation | AUTH-01; account recovery separated into AUTH-02. |
| Priority 2: customer-data lifecycle | DATA-01; current deletion defects separated into FUN-02/FUN-03. |
| Priority 3: integration/deployment release gates | QA-01, OPS-06/OPS-08 and PERF-01; actual passing/skipped/unrun evidence is recorded above. |
| Priority 4: documentation and backlog reconciliation | DOC-01; historical labeling in the original review is already substantially addressed, while other contradictions remain. |
| Priority 5: frontend initial-load performance | PERF-02; current in-memory bundle measurement corroborates the size concern. |

## Follow-up and deployment guardrails

1. Resolve data correctness: full-contract publishing, type/rule consistency,
   raw/preview parity, workbook-query coverage, deletion/history, attempt isolation
   and recoverable message handoff.
2. Unblock the supported customer journey: authentication/error recovery, usable
   editors/keyboard controls, production URL configuration, clean provisioning,
   correct roles/scaler settings, private migrations and first-admin bootstrap.
3. Before promising delivered files, select and verify a durable destination.
   Close session/export/lifecycle risks before broadening customer-data use.
4. Establish integration, recovery, browser, deployment and performance acceptance
   gates; passing unit builds are only one part of release proof.
5. Assign owners and reconcile documentation/backlog with chosen behavior and
   measured evidence. Optimize initial load after correctness/recovery are protected.

No billable Azure provisioning, destructive data migration, production replay,
or authentication architecture change is authorized by this review. Use
owner-approved disposable environments, backups, previews, least-privilege
identities, and cost-aware validation. Record accepted residual risks and
support ownership rather than silently treating missing capabilities as complete.
