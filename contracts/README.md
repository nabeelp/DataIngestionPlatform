# Data quality contracts

The JSON Schema files in this directory are the source of truth for the versioned
definition, rule and messaging contracts. `schemaVersion` is `1` on definitions
and all Service Bus messages. Python models and generated TypeScript declarations
must remain compatible with these schemas; contract examples are checked by the
Python and TypeScript test suites.

## Schemas

- `definition-contract.schema.json` describes table/column settings, lookups and
  the collection of rules in a published definition snapshot.
- `rule-config.schema.json` describes the discriminated `RuleConfig` variants.
- `messages/validation-request.schema.json` is the worker queue message.
- `messages/validation-event.schema.json` is the event topic body.
- `messages/delivery-request.schema.json` is the delivery queue message.

## Type generation

The backend and frontend each expose `npm run contracts:gen`. Their generated
declarations are checked in beneath `src/contracts/` and refreshed automatically
by the corresponding build script. Do not hand-edit generated declarations; edit
the schemas and regenerate instead.

Examples under `examples/` are representative valid payloads for schema tests.
Unknown properties are rejected, and runtime validation must be performed at
service boundaries rather than relying on TypeScript types alone.

## Rule authoring validation

The candidate rule is sent separately from the draft's other rules. The backend
loads lookup values from the database for both the candidate and the other rules,
including when an edited rule selects a different lookup. This applies to unsaved
workspace contracts and saved-definition authoring requests. Client-supplied lookup
values are ignored; missing or malformed stored lookups remain configuration errors.

Both candidate rule validation (Add/Update and example testing) and whole-definition
validation use these JSON Schemas before typed parsing, reference checks and rule
compilation. Python models and generated TypeScript types alone do not enforce every
schema constraint. For example, row count, range, length, date range and aggregate
rules require at least one minimum or maximum bound; zero is a valid numeric bound.
Normalized rules preserve required nullable fields such as `table`, but omit unset
optional parameter values rather than inserting `null` bounds that violate the schema.

Configuration failures return `ok: false` with structured `errors` containing a
`path` and an actionable `message`, rather than a serialized rule or a union-schema
diagnostic. Candidate paths start at `$` (for example, `$.params`); whole-definition
paths include the rule index (for example, `$.rules[0].params`). The workspace uses
these indices to attach messages to the corresponding rules. A row count rule with
no bounds reports "Enter a minimum or maximum row count."
The rule editor displays only the actionable message, not the technical JSON path,
including when showing example-test configuration errors.

Invalid Add/Update submissions leave the editor open and the workspace draft
unchanged. Existing invalid rules remain editable for correction. Configuration
validity is separate from a rule failing against uploaded data: a valid rule may
intentionally reject data that violates its configured bounds or conditions.
