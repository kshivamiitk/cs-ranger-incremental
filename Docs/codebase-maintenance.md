# Understanding and changing CS Ranger

## What the size numbers mean

Run `npm run codebase:report` from the repository root. It counts physical and
nonblank lines in TypeScript, JavaScript, CSS, SQL, and shell source, including
tests. It includes working-tree additions, excludes ignored files, dependencies,
build output, and Next's generated declarations, and lists the largest files.
Documentation, lockfiles, images, and generated course content are not source
code in this report. Comments count toward both totals; blank lines count only
toward the physical total. The report also prints an application-and-database
subtotal excluding tests, utility scripts, and build/test configuration.

The baseline at `146ca38` contains **34,933 physical source lines** under this
definition, before this refactor. Counts vary with the definition; the number
does not measure correctness, feature completeness, or maintainability. Keep
additions purposeful rather than using a line threshold as a quality gate.

## Follow a request through the system

1. `frontend/src/app/` contains pages; shared UI lives in
   `frontend/src/components/`. Start with the page for the feature being changed.
2. `frontend/src/lib/api.ts` defines API calls. Query hooks live in `queries.ts`
   and `hooks.ts` in the same directory.
3. `backend/api-gateway/src/index.ts` verifies identity and proxies API prefixes
   to the domain services. Trace the matching prefix to its service entry point.
4. Each `backend/*-service/src/index.ts` registers domain routes.
   `backend/shared/` supplies response helpers, identity middleware, database
   access, storage, payment integration, and events.
5. `database/migrations/` defines the persisted tables, indexes, functions, and
   access policies. Check the relevant migrations before changing query shapes.

The root package coordinates the frontend and backend. Backend services run
TypeScript through `tsx`; the root `build` script builds the Next.js frontend.
The root `typecheck` checks both layers, including every backend workspace.

## Course-service module boundaries

All paths below are relative to `backend/course-service/src/`. Gateway-facing
course routes are prefixed with `/api/courses`.

| Module | Responsibility |
| --- | --- |
| `index.ts` | Service startup, route composition, course/module/node editing, PDF and storage routes, comments and doubts |
| `access.ts` | Editor roles, parent-course lookup, edit-lock inspection, write authorization |
| `reviews.ts` | Course reviews and the current learner's rating |
| `bookmarks.ts` | Course and lesson bookmarks |
| `collaboration.ts` | Invitations, responses, removals, collaboration notifications |
| `locks.ts` | Lock status, acquisition, heartbeat, release |
| `uploads.ts` | Thumbnails, attachments, and rich images |
| `moderation.ts` | Content reports and admin moderation |
| `validation.ts` | Shared video schemas |
| `pricing.ts` | Price and discount consistency |
| `ordering.ts` | Course-tree ordering |

Route modules export registration functions and do not start servers on import.
`access.ts` has no runtime imports and can be tested without credentials.
Keep literal routes such as `/bookmarks` before the final `GET /:id` catch-all;
registration order is part of the API behavior. Authentication and authorization
stay attached to their original handlers.

Service-role database access bypasses RLS, so route authorization is essential.
Course editing uses `assertCanWriteCourse`: administrators bypass checks; other
users need an editor role and a current lock held by themselves. The SQL
`course_write_check` RPC resolves that decision in one database call.

## Build changes in reviewable steps

For each change, state one observable outcome and keep its implementation,
regression coverage, and necessary documentation together. Separate mechanical
moves from behavior changes when both are needed. Review `git diff --stat` and
`git diff --check` before committing, and explain a large diff rather than
splitting an incomplete feature into arbitrary pieces.

Suggested independent follow-ups, each with its own review:

1. Extract PDF and storage handling from the course entry point, preserving quota
   accounting and ownership checks, with quota and payment regression coverage.
2. Extract comments and doubts, preserving pagination, nested profile joins,
   resolution authorization, and notifications.
3. Split the course builder by editor responsibility, preserving form state and
   autosave behavior.
4. Split the frontend API client by domain, retaining existing caller contracts.

For a backend change, run `npm --prefix backend run typecheck` and
`npm --prefix backend test`. For frontend changes, run the frontend typecheck,
lint, tests, and build. Before merging, run `npm run ci` for both layers.
Local unit tests do not establish live Supabase, Razorpay, Redis, or deployed
gateway correctness; validate those integrations in a configured environment
when changing their behavior.

Do not rewrite existing commit history to simulate gradual development. Make
future commits describe real, validated increments. This refactor preserves
the existing history and does not claim to finish the follow-ups above.
