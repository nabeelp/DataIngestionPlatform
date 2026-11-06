from __future__ import annotations

import json
import re
from pathlib import Path

from jsonschema import Draft7Validator, FormatChecker
from jsonschema.exceptions import ValidationError as SchemaValidationError
from pydantic import TypeAdapter, ValidationError
from referencing import Registry, Resource

from dq_engine.contracts.models import RuleConfig

_ROOT = Path(__file__).resolve().parents[4]
_CONTRACTS = _ROOT / "contracts"
RULE_ADAPTER: TypeAdapter[RuleConfig] = TypeAdapter(RuleConfig)
_RULE_SCHEMA = json.loads((_CONTRACTS / "rule-config.schema.json").read_text(encoding="utf-8"))
_SCHEMA_REGISTRY = Registry().with_resource(
    _RULE_SCHEMA["$id"],
    Resource.from_contents(_RULE_SCHEMA),
)


def _relevant_schema_errors(error: SchemaValidationError) -> list[SchemaValidationError]:
    if error.validator not in {"oneOf", "anyOf"} or not error.context:
        return [error]
    if isinstance(error.instance, dict):
        for index, branch in enumerate(error.validator_value):
            properties = branch.get("properties", {})
            for discriminator in ("type", "op"):
                constraint = properties.get(discriminator, {})
                value = error.instance.get(discriminator)
                if discriminator in error.instance and (
                    ("const" in constraint and value == constraint["const"])
                    or ("enum" in constraint and value in constraint["enum"])
                ):
                    return [
                        leaf
                        for child in error.context
                        if child.schema_path[0] == index
                        for leaf in _relevant_schema_errors(child)
                    ]
    # Date bounds can be either an ISO date or a relative-date object.
    for index, branch in enumerate(error.validator_value):
        if (branch.get("type") == "string" and isinstance(error.instance, str)) or (
            branch.get("type") == "object" and isinstance(error.instance, dict)
        ):
            return [
                leaf
                for child in error.context
                if child.schema_path[0] == index
                for leaf in _relevant_schema_errors(child)
            ]
    return [error]


def _setting_label(path: list[str | int]) -> str:
    key = next((part for part in reversed(path) if isinstance(part, str)), "configuration")
    labels = {
        "min": "minimum", "max": "maximum", "fn": "aggregation function",
        "op": "comparison operator", "as": "comparison type", "lookupId": "lookup",
        "failWhen": "failure condition", "when": "condition", "params": "rule settings",
        "type": "rule type",
    }
    return labels.get(key, re.sub(r"([a-z])([A-Z])", r"\1 \2", key).lower())


def _rule_schema_messages(
    error: SchemaValidationError,
    rule_type: object,
) -> list[tuple[list[str | int], str]]:
    path = list(error.absolute_path)
    label = _setting_label(path)
    if error.validator == "required":
        return [
            (path + [key], f"Specify the {_setting_label([key])}.")
            for key in error.validator_value
            if key not in error.instance
        ]
    if error.validator in {"oneOf", "anyOf"}:
        alternatives = error.validator_value
        if alternatives == [{"required": ["min"]}, {"required": ["max"]}]:
            subject = {
                "rowCount": "row count", "length": "length", "dateRange": "date",
                "aggregate": "result",
            }.get(str(rule_type), "value")
            return [(path, f"Enter a minimum or maximum {subject}.")]
        return [(path, f"Check the {label} and supply a supported configuration.")]
    if error.validator == "additionalProperties":
        return [(path, f"Remove unsupported settings from the {label}.")]
    if error.validator == "type":
        types = error.validator_value
        expected = {
            "integer": "a whole number", "number": "a number", "string": "text",
            "boolean": "true or false", "array": "a list", "object": "an object", "null": "empty",
        }
        description = " or ".join(expected[item] for item in (types if isinstance(types, list) else [types]))
        return [(path, f"Set the {label} to {description}.")]
    if error.validator in {"enum", "const"}:
        choices = error.validator_value if error.validator == "enum" else [error.validator_value]
        return [(path, f"Choose a supported {label}: {', '.join(str(choice) for choice in choices)}.")]
    if error.validator in {"minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "maxProperties"}:
        limit = error.validator_value
        plural = "" if limit == 1 else "s"
        instruction = {
            "minimum": f"at least {limit}", "maximum": f"at most {limit}",
            "minLength": f"at least {limit} character{plural}", "maxLength": f"at most {limit} character{plural}",
            "minItems": f"at least {limit} item{plural}", "maxItems": f"at most {limit} item{plural}",
            "maxProperties": f"at most {limit} setting{plural}",
        }[error.validator]
        return [(path, f"Specify {instruction} for the {label}.")]
    if error.validator == "uniqueItems":
        return [(path, f"Remove duplicate entries from the {label}.")]
    if error.validator == "format":
        return [(path, f"Enter a valid {error.validator_value} for the {label}.")]
    return [(path, f"Enter a valid {label}.")]


def schema_errors(schema_name: str, payload: object) -> list[dict[str, str]]:
    schema_path = _CONTRACTS / schema_name
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = Draft7Validator(
        schema,
        registry=_SCHEMA_REGISTRY,
        format_checker=FormatChecker(),
    )
    errors = sorted(
        validator.iter_errors(payload),
        key=lambda error: tuple(
            (type(part).__name__, str(part))
            for part in error.absolute_path
        ),
    )
    findings: list[dict[str, str]] = []
    for error in errors:
        is_rule = schema_name == "rule-config.schema.json" or list(error.absolute_path)[:1] == ["rules"]
        rule_data = payload
        if (
            schema_name != "rule-config.schema.json" and is_rule
            and isinstance(payload, dict) and len(error.absolute_path) > 1
        ):
            rule_data = payload["rules"][error.absolute_path[1]]
        rule_type = rule_data.get("type") if isinstance(rule_data, dict) else None
        messages = (
            [
                item
                for leaf in _relevant_schema_errors(error)
                for item in _rule_schema_messages(leaf, rule_type)
            ] if is_rule else [(list(error.absolute_path), error.message)]
        )
        for path, message in messages:
            finding = {
                "path": "$" + "".join(
                    f"[{part}]" if isinstance(part, int) else f".{part}"
                    for part in path
                ),
                "message": message,
            }
            if finding not in findings:
                findings.append(finding)
            if len(findings) >= 50:
                return findings
    return findings


def pydantic_errors(error: ValidationError) -> list[dict[str, str]]:
    return [
        {
            "path": "$" + "".join(
                f"[{part}]" if isinstance(part, int) else f".{part}"
                for part in item["loc"]
            ),
            "message": item["msg"],
        }
        for item in error.errors(include_input=False)[:50]
    ]
