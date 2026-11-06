from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from dq_engine.io.models import StructuralIssue
from dq_engine.rules.base import RuleIssue

MAX_ISSUES_PER_CHECK = 100
MAX_REPORT_ISSUES = 1_000_000


@dataclass(slots=True)
class CheckResult:
    id: str
    name: str
    type: str
    severity: str
    status: str
    issue_count: int
    issues: list[RuleIssue]
    elapsed_ms: int
    sheet: str | None


@dataclass(slots=True)
class ReportIssue:
    check_id: str
    check_name: str
    sheet: str | None
    issue: RuleIssue


@dataclass(slots=True)
class ValidationOutcome:
    status: str
    checks: list[CheckResult]
    structural_issues: list[StructuralIssue]
    row_counts: dict[str, int]
    report_issues: list[ReportIssue] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "checks": [
                {
                    **asdict(check),
                    "issues": [asdict(issue) for issue in check.issues],
                }
                for check in self.checks
            ],
            "structuralIssues": [asdict(issue) for issue in self.structural_issues],
            "rowCounts": self.row_counts,
        }
