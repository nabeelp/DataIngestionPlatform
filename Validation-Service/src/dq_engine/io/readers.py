from __future__ import annotations

from pathlib import Path

from dq_engine.contracts.models import DefinitionContract
from dq_engine.io.csv_reader import read_csv_table
from dq_engine.io.excel_reader import read_excel
from dq_engine.io.models import ParsedFile, StructuralIssue, UnrecoverableFileError
from dq_engine.io.sniff import sniff_file


def read_file(path: Path, contract: DefinitionContract) -> ParsedFile:
    metadata = sniff_file(path, contract)
    if metadata.extension in {"csv", "tsv", "txt"}:
        if contract.layout == "sheets":
            return ParsedFile(
                metadata=metadata,
                tables={},
                structural_issues=[
                    StructuralIssue(
                        code="unsupported_layout",
                        message="A sheet-layout definition requires an Excel workbook.",
                    )
                ],
            )
        parsed = read_csv_table(
            path=metadata.path,
            encoding=metadata.encoding,
            delimiter=metadata.delimiter or ",",
            table=contract.tables[0],
        )
        return ParsedFile(
            metadata=metadata,
            tables={contract.tables[0].sheet or "": parsed},
            structural_issues=list(parsed.structural_issues),
        )
    if metadata.extension not in {"xlsx", "xlsm", "xls", "xlsb"}:
        raise UnrecoverableFileError(f"Unsupported file extension: .{metadata.extension}.")
    return read_excel(metadata, contract)
