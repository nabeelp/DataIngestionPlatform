from __future__ import annotations

import polars as pl

from dq_engine.contracts.models import DefinitionContract
from dq_engine.io.parquet_reader import read_parquet_tables


def test_parquet_reader_restores_table_frames_in_contract_order(tmp_path) -> None:
    contract = DefinitionContract.model_validate({
        "schemaVersion": 1,
        "layout": "sheets",
        "ignoredSheets": [],
        "encoding": "auto",
        "tables": [
            {
                "sheet": "Orders",
                "headerRow": 3,
                "allowExtraColumns": True,
                "minRows": None,
                "maxRows": None,
                "columns": [],
            },
            {
                "sheet": "Payments",
                "headerRow": None,
                "allowExtraColumns": True,
                "minRows": None,
                "maxRows": None,
                "columns": [],
            },
        ],
        "rules": [],
        "lookups": {},
    })
    first = tmp_path / "table-1.parquet"
    second = tmp_path / "table-2.parquet"
    pl.DataFrame({"Amount": [12.5]}).write_parquet(first)
    pl.DataFrame({"Amount": [7]}).write_parquet(second)

    parsed = read_parquet_tables([first, second], contract)

    assert list(parsed.tables) == ["Orders", "Payments"]
    assert parsed.tables["Orders"].frame.get_column("Amount").to_list() == ["12.5"]
    assert parsed.tables["Orders"].row_numbers == [4]
    assert parsed.tables["Payments"].row_numbers == [2]
