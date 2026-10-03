from __future__ import annotations

import codecs
import csv
import io
import zipfile
from collections import Counter
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import BinaryIO

from dq_engine.contracts.models import DefinitionContract
from dq_engine.io.models import FileMetadata, UnrecoverableFileError

_TEXT_EXTENSIONS = {".csv", ".tsv", ".txt"}
_EXCEL_EXTENSIONS = {".xlsx", ".xlsm", ".xls", ".xlsb"}
_DELIMITERS = (",", "\t", ";", "|")
_SNIFF_BYTES = 64 * 1024
_OLE_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")


def _detect_encoding(sample: bytes, configured: str) -> tuple[str, int]:
    if sample.startswith(codecs.BOM_UTF8):
        return "utf-8-sig", len(codecs.BOM_UTF8)
    if sample.startswith(codecs.BOM_UTF16_LE):
        return "utf-16", len(codecs.BOM_UTF16_LE)
    if sample.startswith(codecs.BOM_UTF16_BE):
        return "utf-16", len(codecs.BOM_UTF16_BE)
    if b"\x00" in sample:
        even = sample[0::2]
        odd = sample[1::2]
        even_null_ratio = even.count(0) / max(1, len(even))
        odd_null_ratio = odd.count(0) / max(1, len(odd))
        if odd_null_ratio >= 0.2 and even_null_ratio < 0.05:
            return "utf-16-le", 0
        if even_null_ratio >= 0.2 and odd_null_ratio < 0.05:
            return "utf-16-be", 0
    try:
        sample.decode("utf-8")
        return "utf-8", 0
    except UnicodeDecodeError:
        try:
            encoding = "windows-1252" if configured == "auto" else configured
            codecs.lookup(encoding)
            return encoding, 0
        except LookupError as error:
            raise UnrecoverableFileError(f"Unsupported configured encoding: {configured}.") from error


def _delimiter_score(text: str, delimiter: str) -> tuple[int, int]:
    try:
        stable_end = text.rfind("\n")
        if stable_end < 0:
            return (0, 0)
        reader = csv.reader(io.StringIO(text[: stable_end + 1], newline=""), delimiter=delimiter, strict=True)
        counts = [len(row) for row in reader if row]
    except (csv.Error, StopIteration):
        return (0, 0)
    if not counts:
        return (0, 0)
    frequencies = Counter(counts)
    modal_columns, consistent_rows = frequencies.most_common(1)[0]
    if modal_columns <= 1:
        return (0, 0)
    return consistent_rows, modal_columns


def _detect_delimiter(sample: bytes, encoding: str, extension: str) -> str:
    try:
        text = sample.decode(encoding, errors="strict")
    except (UnicodeDecodeError, LookupError) as error:
        raise UnrecoverableFileError("Unable to decode the file header.") from error
    if not text.strip():
        return "\t" if extension == ".tsv" else ","
    preferred = "\t" if extension == ".tsv" else None
    candidates = sorted(_DELIMITERS, key=lambda item: item != preferred)
    scored = [(delimiter, *_delimiter_score(text, delimiter)) for delimiter in candidates]
    delimiter, consistent, columns = max(scored, key=lambda item: (item[1], item[2]))
    if consistent == 0 or columns <= 1:
        return "\t" if extension == ".tsv" else ","
    return delimiter


def sniff_file(path: Path, contract: DefinitionContract) -> FileMetadata:
    extension = path.suffix.lower()
    if extension not in _TEXT_EXTENSIONS | _EXCEL_EXTENSIONS:
        raise UnrecoverableFileError(f"Unsupported file extension: {extension or '(none)'}.")
    try:
        with path.open("rb") as source:
            signature = source.read(_SNIFF_BYTES)
    except OSError as error:
        raise UnrecoverableFileError("The uploaded file could not be read.") from error
    if signature and extension in {".xlsx", ".xlsm"} and not zipfile.is_zipfile(path):
        raise UnrecoverableFileError(f"The content signature does not match {extension}.")
    elif signature and extension == ".xls" and not signature.startswith(_OLE_SIGNATURE):
        raise UnrecoverableFileError("The content signature does not match .xls.")
    elif signature and extension == ".xlsb" and not zipfile.is_zipfile(path):
        raise UnrecoverableFileError("The content signature does not match .xlsb.")
    if extension in _TEXT_EXTENSIONS:
        encoding, _ = _detect_encoding(signature, contract.encoding)
        if (
            b"\x00" in signature
            and encoding not in {"utf-16-le", "utf-16-be"}
            and not signature.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE))
        ):
            raise UnrecoverableFileError(f"The content signature does not match {extension}.")
        delimiter = _detect_delimiter(signature, encoding, extension)
    else:
        encoding = "binary"
        delimiter = None
    return FileMetadata(path=path, extension=extension[1:], encoding=encoding, delimiter=delimiter)


def utf8_stream(source: BinaryIO, encoding: str, chunk_size: int = 64 * 1024) -> io.BufferedReader:
    if encoding in {"utf-8", "utf-8-sig"}:
        return io.BufferedReader(source)  # type: ignore[arg-type]

    temporary = NamedTemporaryFile(mode="w+b")
    decoder = codecs.getincrementaldecoder(encoding)(errors="strict")
    try:
        while chunk := source.read(chunk_size):
            temporary.write(decoder.decode(chunk).encode("utf-8"))
        temporary.write(decoder.decode(b"", final=True).encode("utf-8"))
        temporary.flush()
        temporary.seek(0)
    except (UnicodeDecodeError, LookupError) as error:
        temporary.close()
        raise UnrecoverableFileError("The file cannot be decoded with the configured encoding.") from error
    return io.BufferedReader(temporary)
