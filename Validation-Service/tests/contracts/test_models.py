from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft7Validator, FormatChecker
from pydantic import TypeAdapter, ValidationError
from referencing import Registry, Resource

from dq_engine.contracts.models import (
    DefinitionContract,
    DeliveryRequest,
    RuleConfig,
    ValidationEvent,
    ValidationRequest,
)
from dq_engine.rule_registry import RULE_MODULES as _RULE_MODULES

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "contracts"
EXAMPLES = CONTRACTS / "examples"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validator_for(filename: str) -> Draft7Validator:
    schema = load_json(CONTRACTS / filename)
    rule_schema = load_json(CONTRACTS / "rule-config.schema.json")
    registry = Registry().with_resource(rule_schema["$id"], Resource.from_contents(rule_schema))
    return Draft7Validator(schema, registry=registry, format_checker=FormatChecker())


@pytest.mark.parametrize(
    ("schema_file", "example_file", "model"),
    [
        ("definition-contract.schema.json", "definition-contract.json", DefinitionContract),
        ("messages/validation-request.schema.json", "validation-request.json", ValidationRequest),
        ("messages/validation-event.schema.json", "validation-event.json", ValidationEvent),
        ("messages/delivery-request.schema.json", "delivery-request.json", DeliveryRequest),
    ],
)
def test_schema_examples_validate_with_json_schema_and_pydantic(
    schema_file: str, example_file: str, model: type[Any]
) -> None:
    payload = load_json(EXAMPLES / example_file)

    validator_for(schema_file).validate(payload)
    model.model_validate(payload)


def test_rule_variants_are_a_discriminated_union() -> None:
    contract_data = load_json(EXAMPLES / "definition-contract.json")
    contract = DefinitionContract.model_validate(contract_data)

    assert contract.rules[0].type == "naturalLanguage"


def test_benchmark_rules_match_the_versioned_contract() -> None:
    rules = load_json(ROOT / "Validation-Service" / "tests" / "bench" / "rules.json")
    validate_rule = validator_for("rule-config.schema.json")
    rule_adapter = TypeAdapter(RuleConfig)

    assert len(rules) == 12
    for rule in rules:
        validate_rule.validate(rule)
        rule_adapter.validate_python(rule)


def _removed_rule(rule_type: str, params: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"removed-{rule_type}",
        "name": f"Removed {rule_type}",
        "description": "",
        "severity": "Error",
        "executionOrder": 0,
        "enabled": True,
        "table": None,
        "type": rule_type,
        "params": params,
    }


REMOVED_RULES = [
    _removed_rule("columnsPresent", {"columns": ["Id"]}),
    _removed_rule("required", {"columns": ["Id"]}),
    _removed_rule("type", {"column": "Id", "dataType": "integer"}),
]


@pytest.mark.parametrize("rule", REMOVED_RULES, ids=lambda rule: rule["type"])
def test_removed_rule_types_are_rejected_as_rule_config(rule: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(RuleConfig).validate_python(rule)


def test_contract_with_a_removed_rule_type_is_rejected() -> None:
    payload = load_json(EXAMPLES / "definition-contract.json")
    payload["rules"] = [*REMOVED_RULES, *payload["rules"]]

    with pytest.raises(ValidationError):
        DefinitionContract.model_validate(payload)


def test_every_rule_type_in_the_schema_has_an_engine_implementation() -> None:
    schema = load_json(CONTRACTS / "rule-config.schema.json")
    schema_types = set(schema["properties"]["type"]["enum"])

    assert schema_types == set(_RULE_MODULES)
