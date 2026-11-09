from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import ValidationError

from dq_engine.api.contract_checks import contract_rule_errors, contract_structure_errors
from dq_engine.api.rule_compile import compile_rule
from dq_engine.api.schema_errors import RULE_ADAPTER, pydantic_errors, schema_errors
from dq_engine.contracts.models import (
    DefinitionContract,
    NaturalLanguageRule,
)
from dq_engine.rules.examples import run_examples


def _single_rule_context(contract_data: object) -> object:
    # Other draft rules are validated at publication, not while authoring this candidate.
    if isinstance(contract_data, dict) and isinstance(contract_data.get("rules"), list):
        return {**contract_data, "rules": []}
    return contract_data


def validate_rule_payload(contract_data: object, rule_data: object) -> dict[str, Any]:
    contract_data = _single_rule_context(contract_data)
    errors = schema_errors("definition-contract.schema.json", contract_data)
    errors.extend(schema_errors("rule-config.schema.json", rule_data))
    if errors:
        return {"ok": False, "errors": errors, "normalizedRule": None, "explanation": None}
    try:
        contract = DefinitionContract.model_validate(contract_data)
        rule = RULE_ADAPTER.validate_python(rule_data)
    except ValidationError as error:
        return {"ok": False, "errors": pydantic_errors(error), "normalizedRule": None, "explanation": None}
    errors = contract_structure_errors(contract)
    errors.extend(contract_rule_errors(contract, rule))
    if not errors:
        errors.extend(compile_rule(contract, rule))
    explanation = rule.params.explanation if isinstance(rule, NaturalLanguageRule) else rule.description
    normalized_rule = rule.model_dump(by_alias=True)
    normalized_rule["params"] = rule.params.model_dump(by_alias=True, exclude_none=True)
    return {
        "ok": not errors,
        "errors": errors,
        "normalizedRule": normalized_rule,
        "explanation": explanation,
    }


def validate_contract_payload(contract_data: object) -> dict[str, Any]:
    errors = schema_errors("definition-contract.schema.json", contract_data)
    if errors:
        return {"ok": False, "errors": errors}
    try:
        contract = DefinitionContract.model_validate(contract_data)
    except ValidationError as error:
        return {"ok": False, "errors": pydantic_errors(error)}

    errors = contract_structure_errors(contract)
    for rule_index, rule in enumerate(contract.rules):
        rule_errors = contract_rule_errors(contract, rule)
        if not rule_errors:
            rule_errors.extend(compile_rule(contract, rule))
        errors.extend(
            {
                "path": f"$.rules[{rule_index}]{item['path'][1:]}",
                "message": item["message"],
            }
            for item in rule_errors
        )
        if isinstance(rule, NaturalLanguageRule):
            examples = run_examples(contract, rule, validation_date=date(2025, 1, 15))
            errors.extend(
                {
                    "path": f"$.rules[{rule_index}].params.examples[{example.index - 1}]",
                    "message": example.error or (
                        "Example result does not match expectedValid."
                    ),
                }
                for example in examples
                if not example.passed
            )
    return {"ok": not errors, "errors": errors}


def test_rule_examples(
    contract_data: object,
    rule_data: object,
    examples_data: object | None,
) -> dict[str, Any]:
    contract_data = _single_rule_context(contract_data)
    validation = validate_rule_payload(contract_data, rule_data)
    if not validation["ok"]:
        return {"ok": False, "errors": validation["errors"], "results": []}
    try:
        contract = DefinitionContract.model_validate(contract_data)
        rule = RULE_ADAPTER.validate_python(rule_data)
    except ValidationError as error:
        return {"ok": False, "errors": pydantic_errors(error), "results": []}
    if not isinstance(rule, NaturalLanguageRule):
        return {
            "ok": False,
            "errors": [{"path": "$.rule.type", "message": "Example tests require a Natural Language rule."}],
            "results": [],
        }
    try:
        from dq_engine.contracts.models import NaturalLanguageExample

        if examples_data is not None and not isinstance(examples_data, list):
            return {
                "ok": False,
                "errors": [{"path": "$.examples", "message": "Examples must be an array."}],
                "results": [],
            }
        examples = (
            [NaturalLanguageExample.model_validate(item) for item in examples_data]
            if examples_data is not None
            else None
        )
    except (TypeError, ValidationError) as error:
        details = pydantic_errors(error) if isinstance(error, ValidationError) else [
            {"path": "$.examples", "message": "Examples must be an array."}
        ]
        return {"ok": False, "errors": details, "results": []}
    results = run_examples(contract, rule, examples, date(2025, 1, 15))
    return {
        "ok": all(result.passed for result in results),
        "errors": [],
        "results": [
            {
                "index": result.index,
                "table": result.table,
                "expectedValid": result.expected_valid,
                "actualValid": result.actual_valid,
                "passed": result.passed,
                "error": result.error,
            }
            for result in results
        ],
    }
