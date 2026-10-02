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
