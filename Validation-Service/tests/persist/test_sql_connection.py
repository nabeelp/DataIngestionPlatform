from __future__ import annotations

import pytest

from dq_engine.persist.sql import _mssql_python_connection_string


def test_mssql_python_connection_string_normalizes_sql_client_aliases() -> None:
    connection_string, timeout = _mssql_python_connection_string(
        "Data Source=localhost,1433;Initial Catalog=Validation;User ID=sa;"
        "Password={a;secret};Encrypt=True;TrustServerCertificate=True;Connect Timeout=30"
    )

    assert connection_string == (
        "server=localhost,1433;database=Validation;uid=sa;pwd={a;secret};"
        "Encrypt=yes;TrustServerCertificate=yes"
    )
    assert timeout == 30


def test_mssql_python_connection_string_rejects_malformed_parameters() -> None:
    with pytest.raises(ValueError, match="invalid parameter"):
        _mssql_python_connection_string("Server=localhost;broken")
