from __future__ import annotations

from pathlib import Path

import polars as pl

from dq_engine.contracts.models import DefinitionContract
from dq_engine.io.models import FileMetadata, ParsedFile, ParsedTable, UnrecoverableFileError


def read_parquet_tables(paths: list[Path], contract: DefinitionContract) -> ParsedFile:
    if len(paths) != len(contract.tables):
        raise UnrecoverableFileError("The stored Parquet tables do not match the supplied definition.")

    tables: dict[str, ParsedTable] = {}
    for definition, path in zip(contract.tables, paths, strict=True):
        try:
            frame = pl.read_parquet(path).select(pl.all().cast(pl.String, strict=False))
        except (OSError, pl.exceptions.PolarsError) as error:
            raise UnrecoverableFileError("A stored Parquet table could not be read.") from error
        name = definition.sheet or ""
        if name in tables:
            raise UnrecoverableFileError("The supplied definition contains duplicate table names.")
        first_data_row = (definition.headerRow or 1) + 1
        tables[name] = ParsedTable(
            name=name,
            definition=definition,
            frame=frame,
            row_numbers=list(range(first_data_row, first_data_row + frame.height)),
            source_columns=frame.columns,
        )

    return ParsedFile(
        metadata=FileMetadata(paths[0], "parquet", "binary", None),
        tables=tables,
    )
