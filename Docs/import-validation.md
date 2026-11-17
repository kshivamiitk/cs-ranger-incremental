# Import validation

Validated locally on 17 November 2026 after installing locked dependencies in
the new repository, independently of the original working directory.

## Measured requirements

- Application and database: **31,128 physical lines**, excluding tests, utility
  scripts, build/test configuration, dependencies, generated output, and locks.
- Initial migration: **124 import commits**, grouped by subsystem and feature.
- Median import size: **330 added lines**; **110 of 124** imports add at most
  500 lines. The remaining 14 each import one complete pre-existing file,
  including the two large generated dependency locks.
- Normal maintenance commits follow the import. Run `npm run codebase:report`
  and `git rev-list --count HEAD` for the current totals.

Physical lines include comments and blanks. A file count or commit count does
not independently establish authorship. See `IMPORT_HISTORY.md` for provenance
and the distinction between import order and original development history.

## Local checks

| Check | Result |
| --- | --- |
| `npm run ci` | Passed: frontend/backend typechecks, lint, tests, frontend production build |
| Backend tests | 180 passed across 15 files |
| Frontend tests | 13 passed across 3 files |
| Frontend lint | Passed with two existing React hook dependency warnings |
| Root production dependency audit | Passed; zero advisories reported |
| Backend production dependency audit | Failed; 7 advisories (1 moderate, 5 high, 1 critical) |
| Frontend production dependency audit | Failed; 40 advisories (1 low, 28 moderate, 9 high, 2 critical) |

Audits used `npm audit --omit=dev --audit-level=high` in each package directory.
Counts describe that run and may change as the advisory database changes.
The GitHub workflow includes audit gates in addition to `npm run ci`; those
gates will fail until dependency remediation is completed. This import does
not suppress them or change dependency versions to conceal the result.

Follow up with separate dependency upgrades and compatibility testing, including
the pinned Next.js version and the Zod major-version migration identified by
the audit. Live Supabase, Razorpay, Redis, deployment, and production traffic
were not exercised by the local checks.

Original files were copied without including ignored environment files or
dependencies. New-repository changes beyond the course-service refactor and
maintenance tools are the import documentation, this validation record, commit
metrics, and manual deployment trigger. The original repository history remains
at its original tip and was not rewritten or pushed.
