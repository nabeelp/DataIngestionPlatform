# User Guide

## Who This Is For

This guide is for uploaders reviewing files and for administrators managing
definitions and user access. The solution is a proof of concept; use only data
approved for the environment. See the [handover](poc-handover.md).

## Before You Begin

Ask your administrator for the application address, an account and access to
the appropriate file definition. Prepare a CSV, TSV, TXT or Excel file matching
its published columns and rules. The default upload size limit is 100 MB.
For sheet-specific definitions, upload a workbook with the named sheets.

## Sign In and First Use

Sign in with an application password or Microsoft Entra SSO if configured.
Open **My Files** to see definitions available to you, including their
published columns and rules. Local mock login is for development only.

## Main Workflows

### Upload and review

1. Select an available definition from **My Files** or **Upload File**.
2. Choose a file and select **Upload and validate**.
3. Open **Upload History**, then the upload details to see its pinned definition
   version, checks, warnings and sample issues. Download the issues report if needed.
4. If validation fails, correct the source and use **Upload corrected file**.
   **Retry stored file** reprocesses the existing upload against its recorded
   version; it does not upload your edits.
5. If delivery is configured and completed, an authorized user can download
   the delivered output from the upload details.

### Manage definitions and rules

Administrators use **File Definitions** to create a definition from a clean
slate or an example CSV/XLSX file, review tables and rules, and publish version
1. Editing uses the workspace and a review/publish step; unsaved workspace
changes are discarded when leaving or cancelling. Later publications do not
change the contract pinned to earlier uploads. Review suggested rules and
example-file columns before publishing.

In the **Rules** step, choose a built-in rule or **Describe a rule**. A
natural-language proposal may be mapped, require restricted SQL, or be
rejected. Inspect the explanation, examples and empty-value behavior before
adding it to the draft and publishing. Validation against examples does not
prove the rule captures the intended meaning. The
[rule guide](natural-language-rules.md) describes the checks and limits.

Administrators can manage users, access grants and lookups and inspect audit,
monitoring and compliance pages. Avoid deleting referenced definitions or
lookups until their known deletion limitations are resolved; see the
[backlog](../TODO.md).

## Offline and Reconnect Behavior

The application depends on its services and does not provide an offline work
mode. Reconnecting does not currently reconcile all live state automatically;
reload the relevant page and verify the upload status before retrying.
Do not assume an interrupted request failed or create duplicates without
checking history first.

## Statuses and Notifications

Uploads progress from uploaded and queued through validation. Failed checks
produce a failed validation; warnings alone do not fail it. A passing upload
without a delivery folder finishes as `VALIDATED`; one with delivery configured
progresses through delivery and can finish as `DELIVERED` or `DELIVERY_FAILED`.
Live updates use Socket.IO; check the history page if updates stop.

## Attachments or Other Data

Uploads and reports are stored by the service; a definition can also have a
reusable template. Example files used for definition analysis are staged and
then deleted after analysis. Delivery is optional. Uploads and outputs do not
currently have a complete age-based retention policy.

## Accessibility and Mobile Use

Keyboard accessibility is incomplete: the upload drop zone and definition
rows are not keyboard-operable. No mobile or accessibility conformance claim
has been verified. See UI-03 in the [backlog](../TODO.md).

## Privacy and Data Handling

Use synthetic or explicitly approved data. Upload files and issue reports may
contain sensitive values. Natural-language rule requests and draft schema names
are sent through the configured gateway; do not put sensitive values in rule
text. Downloaded CSV reports currently lack formula-injection neutralization;
handle them as untrusted when opening in spreadsheet software.

## Troubleshooting

- **Cannot sign in or a session expired:** contact your administrator. Session
  failure recovery has a known UI issue; do not assume reload resolves it.
- **Definition unavailable:** ask an administrator to verify your access grant
  and the published definition.
- **Upload rejected:** check file format, size, sheet names and required columns.
- **Validation or delivery appears stuck:** check history first, then report the
  upload ID and approximate time to an administrator. Do not send file contents
  or credentials in a support request.
- **Rule proposal rejected:** use the visible explanation, clarify the request
  and schema, and retry. Gateway access and rate limits may also prevent review.

## Getting Help

Contact the environment administrator or use the repository's issue tracker.
Provide a sanitized description and upload ID where relevant, not tokens,
connection strings, file contents or sensitive rule text.
