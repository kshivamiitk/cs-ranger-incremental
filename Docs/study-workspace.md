# Learner study workspace

The learner navigation links to `/study`. It provides:

- Learning goals with time targets, optional due dates, completion, and archiving.
- A task planner with dates, priorities, goal links, search, overdue and completed views.
- A focus timer with pause/resume, early completion, reload recovery, and session history.
- Private flashcard decks, editable cards, tags, suspension, archiving, and JSON imports/exports.
- Active-recall sessions with Again/Hard/Good/Easy grades and adaptive next-review dates.
- Weekly activity, goal progress, review recall statistics, and study streaks in the selected timezone.
- Preferences and a downloadable JSON copy of the workspace.

## Run it

Use **Node.js 22 or newer**, matching CI. Install dependencies and run the app
using the root README instructions. The study API is hosted by the existing
user service; it does not require another service, port, paid API, or API key.

For an existing Supabase project, apply the new migration before using the
feature. This command changes the database you explicitly select:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/0043_study_workspaces.sql
```

New installations receive the migration through `database/apply.sh`. The
migration creates `study_workspaces` and `save_study_workspace`. It does not
change existing users, enrollments, courses, payments, or study records.

When Supabase is configured, missing tables or database outages return an
explicit failure. The service does not report a successful save using a mock
fallback. In production, Supabase configuration remains mandatory.

Without Supabase in development, the user service saves private workspace files
under `.local/study` relative to its working directory, normally
`backend/.local/study`. Set `STUDY_DATA_DIR` to an absolute directory to override
it. These files are ignored by Git, use hashed filenames, and are replaced
atomically. They survive restarts on that host, but do not sync across hosts.
The UI identifies this development storage mode.

File storage uses per-workspace lock files. If the process crashes during a
write, stop the development service and remove the corresponding stale `.lock`
file before restarting. Do not delete a workspace JSON file to resolve a lock.
Invalid saved data produces an error instead of resetting the workspace.

## Important behavior

All API routes are under `/api/users/me/study` and require authentication. The
owner is always taken from the authenticated identity; request bodies cannot
select another user. Public Supabase roles cannot directly read the table or
execute the save function. The service-role client is protected by the existing
gateway identity boundary.

Writes use optimistic version checks. A concurrent change reloads and retries
against the latest workspace; repeated conflicts return 409. Failed commands
never mutate stored state. Review operations use client-generated UUIDs so a
retry does not record a second review within the retained event history.

Focus duration is calculated from server timestamps, excludes pauses, and is
capped at the planned length. Only completed sessions contribute study time.
Cancelling contributes no time; completing a task is a separate action. One
running or paused session is allowed at a time. Finishing the visual countdown
does not silently mark a task complete or save a completed session.

Flashcard scheduling is deterministic and inspired by SM-2; it is not FSRS or
an exact SM-2 implementation. Again schedules another attempt in ten minutes;
Hard, Good, and Easy schedule future days based on prior recall. Suspended cards
and archived decks are omitted from review queues. A review session snapshots
its initial queue and uses the configured cards-per-session limit. There is no
claim that this limit is a daily quota. Editing a card preserves its schedule.

Workspace limits are 100 goals, 2,000 tasks, 100 decks, and 5,000 cards, subject
to a two-million-byte application document limit. The database additionally
bounds the JSONB text representation to 3 MiB to allow normalization overhead.
The latest 2,000 review events and 1,000 sessions are retained; statistics only
cover retained history. Deleting goals or tasks detaches their references from
other records. Deleting decks also deletes their cards, while historical review
activity remains. Full-workspace restore is not supported; deck JSON can be
exported and imported in batches of 1–100 cards, at most 200 KB per import.

## Verification

```bash
npm run ci
npm run test:study-db
npm run test:study-browser
```

`ci` checks both layers and builds the production frontend. `test:study-db`
requires local PostgreSQL binaries, creates a temporary cluster and Unix socket,
installs the migration twice, checks permissions/version conflicts/constraints,
and stops the cluster. It never uses `DATABASE_URL`. Override `PG_BINDIR` if
`pg_config` does not locate the required server binaries.

The browser smoke test requires Chrome and a completed frontend build. Set
`CHROME_PATH` on Linux or if Chrome is installed elsewhere. It refuses occupied
ports 4000/4002/4009/3107/9337, starts isolated processes, creates a temporary
signed development identity and local data directory, and drives the real
browser UI through goal/task creation, focus pause/resume/completion, flashcard
creation/review, and page reload. It verifies the resulting API state and stops
its processes. The test does not sign in to a real account, access a remote
Supabase project, send real email, or deploy anything.

Unit and HTTP regression tests additionally cover invalid inputs, account
isolation, archived/suspended states, duplicate reviews, concurrent writes,
corrupt files, restart persistence, clock bounds, and timezone boundaries.
Configured Supabase HTTP access and production traffic still require validation
in a deployment environment. Existing dependency audit failures are recorded in
`Docs/import-validation.md` and are not hidden by the local `ci` script.

## Authorship and size

These features were developed with AI assistance. `npm run codebase:report`
reports application/database lines separately from tests and utility scripts.
Test SQL is excluded from the application subtotal. These additions do not
establish human-only authorship, change the disclosed import provenance, or
claim that the repository has reached 50,000 application lines.
