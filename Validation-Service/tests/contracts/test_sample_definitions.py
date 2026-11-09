from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator
from pydantic import TypeAdapter
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "samples" / "tools"))

from samplegen.definitions import (  # noqa: E402
    DEFINITIONS,
    _definition_contract,
    definitions_json,
    definitions_sql,
)

from dq_engine.contracts.models import DefinitionContract, RuleConfig  # noqa: E402


def _validator(filename: str) -> Draft7Validator:
    contracts = ROOT / "contracts"
    schema = json.loads((contracts / filename).read_text(encoding="utf-8"))
    rule_schema = json.loads((contracts / "rule-config.schema.json").read_text(encoding="utf-8"))
    registry = Registry().with_resource(rule_schema["$id"], Resource.from_contents(rule_schema))
    return Draft7Validator(schema, registry=registry)


def test_generated_sample_definitions_match_contract_schemas() -> None:
    contract_validator = _validator("definition-contract.schema.json")
    rule_validator = _validator("rule-config.schema.json")
    contract_adapter = TypeAdapter(DefinitionContract)
    rule_adapter = TypeAdapter(RuleConfig)

    for key, definition in DEFINITIONS.items():
        contract, rules = _definition_contract(key, definition)
        contract_validator.validate(contract)
        contract_adapter.validate_python(contract)
        for rule in rules:
            rule_validator.validate(rule)
            rule_adapter.validate_python(rule)


def test_generated_sample_seed_uses_current_database_columns() -> None:
    sql = definitions_sql()

    assert "INSERT INTO FileDefinitions (Id, Name, Description, Contract, Status)" in sql
    assert "INSERT INTO Rules (Id, FileDefinitionId, Config, ConfigSchemaVersion, IsEnabled)" in sql
    assert "SqlQuery" not in sql
    assert "Columns, Tables" not in sql


def test_published_sample_definitions_are_contracts_and_up_to_date() -> None:
    published = json.loads((ROOT / "samples" / "definitions" / "sample_definitions.json").read_text(encoding="utf-8"))

    assert published == definitions_json()
    for definition in published.values():
        assert set(definition) == {"name", "description", "contract"}
        DefinitionContract.model_validate(definition["contract"])
