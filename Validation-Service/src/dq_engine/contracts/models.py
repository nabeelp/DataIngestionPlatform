from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ColumnDefinition(ContractModel):
    name: str
    type: Literal["string", "integer", "decimal", "date", "datetime", "boolean"]
    mustExist: bool
    nullable: bool
    format: str | list[str] | None = None
    decimalSeparator: str = "."
    thousandsSeparator: str | None = None
    precision: int | None = Field(default=None, ge=1, le=38)
    scale: int | None = Field(default=None, ge=0, le=38)
    maxLength: int | None = Field(default=None, ge=0)
    unique: bool = False


class TableDefinition(ContractModel):
    sheet: str | None
    headerRow: int | None = Field(ge=1)
    allowExtraColumns: bool
    minRows: int | None = Field(ge=0)
    maxRows: int | None = Field(ge=0)
    columns: list[ColumnDefinition]


class LookupDefinition(ContractModel):
    name: str
    values: list[str]


class RuleParams(ContractModel):
    pass


class ColumnsParams(RuleParams):
    columns: list[str] = Field(min_length=1)


class ColumnsPresentRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["columnsPresent"]
    params: ColumnsParams


class RequiredRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["required"]
    params: ColumnsParams


class TypeParams(RuleParams):
    column: str
    dataType: Literal["string", "integer", "decimal", "date", "datetime", "boolean"]
    format: str | list[str] | None = None
    decimalSeparator: str | None = Field(default=None, min_length=1, max_length=1)
    thousandsSeparator: str | None = Field(default=None, max_length=1)


class TypeRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["type"]
    params: TypeParams


class EnumParams(RuleParams):
    column: str
    values: list[str] = Field(min_length=1)
    caseSensitive: bool = True
    trim: bool = True


class EnumRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["enum"]
    params: EnumParams


class RangeParams(RuleParams):
    column: str
    min: float | None = None
    max: float | None = None
    minInclusive: bool = True
    maxInclusive: bool = True


class RangeRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["range"]
    params: RangeParams


class PatternParams(RuleParams):
    column: str
    pattern: str
    caseSensitive: bool = True


class PatternRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["pattern"]
    params: PatternParams


class LengthParams(RuleParams):
    column: str
    min: int | None = Field(default=None, ge=0)
    max: int | None = Field(default=None, ge=0)


class LengthRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["length"]
    params: LengthParams


class UniqueRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["unique"]
    params: ColumnsParams


class LookupParams(RuleParams):
    column: str
    lookupId: str
    caseSensitive: bool = True


class LookupRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["lookup"]
    params: LookupParams


class RelativeDate(ContractModel):
    relative: str


type DateBound = str | RelativeDate


class DateRangeParams(RuleParams):
    column: str
    min: DateBound | None = None
    max: DateBound | None = None


class DateRangeRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["dateRange"]
    params: DateRangeParams


class EqualsCondition(ContractModel):
    column: str
    op: Literal["eq", "ne"]
    value: str


class InCondition(ContractModel):
    column: str
    op: Literal["in"]
    values: list[str] = Field(min_length=1)


class EmptyCondition(ContractModel):
    column: str
    op: Literal["empty", "notEmpty"]


type Condition = Annotated[
    EqualsCondition | InCondition | EmptyCondition,
    Field(discriminator="op"),
]


class ConditionalRequiredParams(RuleParams):
    columns: list[str] = Field(min_length=1)
    when: Condition


class ConditionalRequiredRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["conditionalRequired"]
    params: ConditionalRequiredParams


class CompareParams(RuleParams):
    left: str
    op: Literal["lt", "le", "eq", "ne", "ge", "gt"]
    right: str
    as_: Literal["number", "date", "string"] = Field(alias="as")


class CompareRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["compare"]
    params: CompareParams


class RowCountParams(RuleParams):
    min: int | None = Field(default=None, ge=0)
    max: int | None = Field(default=None, ge=0)


class RowCountRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["rowCount"]
    params: RowCountParams


class AggregateParams(RuleParams):
    column: str
    fn: Literal["sum", "min", "max", "avg", "count", "countDistinct"]
    min: float | None = None
    max: float | None = None


class AggregateRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["aggregate"]
    params: AggregateParams


class AggregateReference(ContractModel):
    table: str
    column: str
    fn: Literal["sum", "min", "max", "avg", "count", "countDistinct"]


class ReconcileParams(RuleParams):
    left: AggregateReference
    right: AggregateReference
    tolerance: float = Field(default=0, ge=0)


class ReconcileRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["reconcile"]
    params: ReconcileParams


class NaturalLanguageExample(ContractModel):
    table: str
    values: dict[str, str]
    expectedValid: bool
    source: Literal["model", "admin"]


class RuleProvenance(ContractModel):
    model: str
    responseId: str
    promptSha256: str
    createdAt: str


class NaturalLanguageParams(RuleParams):
    request: str
    explanation: str
    mode: Literal["row", "query"]
    failWhen: str | None = None
    query: str | None = None
    message: str
    columns: dict[str, list[str]]
    examples: list[NaturalLanguageExample]
    provenance: RuleProvenance


class NaturalLanguageRule(ContractModel):
    id: str
    name: str
    description: str
    severity: Literal["Error", "Warning"]
    executionOrder: int = Field(ge=0)
    enabled: bool
    table: str | None
    type: Literal["naturalLanguage"]
    params: NaturalLanguageParams


type RuleConfig = Annotated[
    ColumnsPresentRule
    | RequiredRule
    | TypeRule
    | EnumRule
    | RangeRule
    | PatternRule
    | LengthRule
    | UniqueRule
    | LookupRule
    | DateRangeRule
    | ConditionalRequiredRule
    | CompareRule
    | RowCountRule
    | AggregateRule
    | ReconcileRule
    | NaturalLanguageRule,
    Field(discriminator="type"),
]


class DefinitionContract(ContractModel):
    schemaVersion: Literal[1]
    layout: Literal["single", "sheets"]
    ignoredSheets: list[str]
    encoding: Literal["auto", "utf-8", "utf-16", "windows-1252", "iso-8859-1"]
    tables: list[TableDefinition] = Field(min_length=1)
    rules: list[RuleConfig]
    lookups: dict[str, LookupDefinition]


class BlobReference(ContractModel):
    container: str
    name: str


class ValidationRequest(ContractModel):
    schemaVersion: Literal[1]
    uploadId: str
    definitionVersionId: str
    blob: BlobReference
    fileType: Literal["csv", "tsv", "txt", "xlsx", "xlsm", "xls", "xlsb"]
    requestedAt: str
    correlationId: str


class ValidationSummary(ContractModel):
    status: Literal["PASSED", "WARNING", "FAILED"]
    passed: int = Field(ge=0)
    failed: int = Field(ge=0)
    warnings: int = Field(ge=0)
    rowCount: int = Field(ge=0)


class ValidationEvent(ContractModel):
    schemaVersion: Literal[1]
    uploadId: str
    type: Literal["progress", "completed", "failed"]
    stage: Literal["download", "sniff", "parse", "rules", "persist"]
    percent: int = Field(ge=0, le=100)
    summary: ValidationSummary | None = None
    error: str | None = None


class DeliveryRequest(ContractModel):
    schemaVersion: Literal[1]
    uploadId: str
    attempt: int = Field(ge=1, le=5)
