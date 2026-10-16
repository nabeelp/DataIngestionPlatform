from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import polars as pl

from dq_engine.contracts.models import TableDefinition


class UnrecoverableFileError(ValueError):
    """The file cannot be processed and should not be retried."""


@dataclass(frozen=True, slots=True)
class FileMetadata:
    path: Path
    extension: str
    encoding: str
    delimiter: str | None


@dataclass(frozen=True, slots=True)
class StructuralIssue:
    code: str
    message: str
    row: int | None = None
    column: str | None = None


@dataclass(slots=True)
class ParsedTable:
    name: str
    definition: TableDefinition
    frame: pl.DataFrame
    row_numbers: list[int]
    source_columns: list[str]
    structural_issues: list[StructuralIssue] = field(default_factory=list)


@dataclass(slots=True)
class ParsedFile:
    metadata: FileMetadata
    tables: dict[str, ParsedTable]
    structural_issues: list[StructuralIssue] = field(default_factory=list)


@dataclass(slots=True)
class ReadableWorkbook:
    metadata: FileMetadata
    reader: object


FileExtension = Literal["csv", "tsv", "txt", "xlsx", "xlsm", "xls", "xlsb"]
