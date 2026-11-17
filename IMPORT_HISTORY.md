# Incremental import history

This repository is a staged import of the existing CS Ranger project from
`https://github.com/kshivamiitk/cs-ranger` at commit `146ca38`, plus the local
course-service refactor, regression tests, size report, and maintenance guide.
The original repository and its development history are preserved separately.

The `import(...)` commits record real file additions made during this migration.
They are not the original development timeline and do not imply that the project
was originally written in this order. Commit timestamps are the actual migration
times; dates and authors have not been reconstructed.

Imports are grouped by subsystem and feature, normally at most 500 physical
lines and eight files per commit. A complete pre-existing file larger than that
limit is imported alone rather than committed as incomplete code. Generated
package lockfiles are separate commits and are excluded from source metrics.
Intermediate imports are partial snapshots; the complete imported tree is the
validation target. No empty commits or arbitrary partial-file commits are used.

Run `npm run codebase:report` for the measured application/database subtotal and
the broader source-and-tests count. These metrics exclude dependencies, build
artifacts, and lockfiles. Line counts describe project files; they do not by
themselves establish authorship or licensing provenance.

See `Docs/codebase-maintenance.md` for the request-flow map, refactor boundaries,
validation commands, and suggested independent follow-ups. Future changes should
be normal, tested feature or refactor commits rather than further import stages.

The new repository keeps CI enabled. Production deployment is manual through
`workflow_dispatch` until its hosting and secrets are configured deliberately.
