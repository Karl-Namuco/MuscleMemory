# Architecture and data

## Account foundation

The client uses React, Vite, strict TypeScript, React Router, React Hook Form, Zod, Tailwind CSS, and selected Radix controls. Firebase Authentication provides email/password accounts. Firestore stores private profile, training configuration, and workout data. Dexie stores recoverable account-scoped drafts and workout checkpoints. Vite PWA generates the production asset cache and manifest.

| Layer        | Responsibility                                                                | Location                                                                                                         |
| ------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Application  | Routing, account gates, responsive shell                                      | [app](../src/app/)                                                                                               |
| Features     | Authentication, onboarding, profile, training configuration, logging, history | [features](../src/features/)                                                                                     |
| Services     | Firebase initialization, account lifecycle, repository operations             | [services](../src/services/)                                                                                     |
| Validation   | Runtime account, training, workout, and checkpoint validation                 | [schemas](../src/schemas/)                                                                                       |
| Types        | Stored account, training, and workout contracts                               | [types](../src/types/)                                                                                           |
| Local drafts | Account-scoped forms and workout interruption recovery                        | [onboarding drafts](../src/features/onboarding/draft.ts), [workout storage](../src/services/workouts/storage.ts) |

Routes wait for authentication resolution. An unapproved account sees the approval screen. An approved account with incomplete onboarding enters setup before the authenticated shell. Completed accounts can open Today, Plan, Train, History, Progress, Profile, and Settings. Plan manages routines and splits; Train starts or resumes a workout and links to completed or ended-early history. Progress analytics and adaptive scheduling remain upcoming features.

## Current database model

| Path                           | Contents                                                                                                                                        | Access                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `approvedUsers/{uid}`          | Administrator-maintained `active` boolean                                                                                                       | Owner may read their own document; clients cannot list or write |
| `users/{uid}`                  | `uid`, display name, onboarding status, schema version, integer creation/update timestamps                                                      | Approved owner may read and create/update                       |
| `users/{uid}/preferences/main` | Goals, units, timezone, experience, days, duration, mode, split, equipment, exercise preferences, recovery preference, optional initial history | Approved owner may read and create/update                       |

The profile and preferences are created and saved together in an atomic batch. Rules require both documents to exist after the write. Ownership and creation time are immutable, updates must advance the timestamp, and unrecognized fields or invalid preference combinations are rejected. Training collections have the additional rules described below. Other paths are denied. Client-side Zod validation adds form feedback and checks stored data before it reaches the UI.

Preference arrays use bounded, unique values. Preferred days and rest days cannot overlap; favorite and excluded exercises cannot overlap. Weekday values use Sunday `0` through Saturday `6`. Date-only initial training history remains a calendar date, separate from timestamp instants. Initial history is user-provided context, not a logged workout.

## Current offline behavior

Firestore persistent caching owns cloud-backed account data and pending writes. The interface distinguishes cached data, durable device checkpoints, pending synchronization, and cloud-confirmed data. Saving may complete locally while offline; cloud confirmation follows only after Firestore acknowledges it. Sign-out is blocked while changes are awaiting synchronization or recoveries remain unresolved. Account transitions clear visible state, listeners, Firestore cache, and feature drafts before another account is used. Workout cleanup removes only validated, confirmed checkpoint records; dirty, rejected, conflicted, interrupted, or malformed records are preserved across UIDs for their owning account. Another open tab can prevent Firestore cache clearing and must be closed.

Onboarding drafts are stored in IndexedDB by UID, including the current step. Draft recovery preserves unfinished input, including fields that still need validation. These drafts are local convenience data, not a second cloud synchronization system.

Production builds precache application assets. The development server intentionally does not enable the service worker. Update prompts let users choose when to reload. Cached training configuration can be edited offline. Train, the active workout editor, and workout history are loaded eagerly with the application so an already-open client can navigate between them offline; offline reload still depends on the production asset cache and available account data.

## Training configuration

Built-in exercises are versioned application data. Custom exercises, routines, splits, and the active split are private to each approved account:

| Path under `users/{uid}`                        | Contents                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `customExercises/{id}`                          | Movement details, tracking type, muscles, cues, alternatives, and archive state  |
| `routines/{id}`                                 | Exercise snapshots, ordered planned sets, rests, optional entries, and supersets |
| `routines/{id}/validationPages/p0` through `p3` | Internal bounded validation records, atomically written with a routine           |
| `splits/{id}`                                   | Up to 12 ordered routine/rest slots and a future scheduling-style preference     |
| `trainingSettings/current`                      | Active split identifier                                                          |

Routines support up to 20 exercises and 12 sets per exercise. Firestore rules have a 1,000-expression limit per write, so each routine save includes one to four validation pages of at most six exercises. Page rules validate each entry; root rules require their exact concatenation, owner, revision, and mutation identifier to match the full routine. Pages cannot be read, listed, deleted, or replaced independently by a client. This preserves the full routine shape and adds one to four writes per routine save. Template batches contain only routines of six exercises or fewer and stay within the batch access budget.

Rules enforce metadata, revision ancestry, recognized entry keys, identifier/text bounds, set-list bounds, rest values, and optional/superset structure. Strict runtime schemas additionally validate individual planned-set values, tracking-specific combinations, snapshot contents, unique identifiers, and superset membership on every application read/write. These nested runtime checks are not all duplicated in database rules. Direct database edits can therefore produce application-invalid data; the application reports a validation error instead of rendering it.

Archiving preserves configuration. An active split is deactivated atomically when archived, and its routines remain intact. Routines referenced by the active split cannot be archived until removed from that split. Two competing writes cannot silently overwrite each other: the next revision must name the preceding mutation. The editor preserves a conflicted draft and offers an explicit discard/load-latest action.

Account-scoped IndexedDB holds unfinished exercise, routine, and split forms. A local recovery ledger retains submitted mutation payloads until backend acknowledgement. The shared sync indicator separates cached, locally saved, and cloud-confirmed state. Rejected saves can be downloaded before clearing their recovery records; queued writes cannot be cleared this way. Sign-out waits for loading/synchronization and unresolved recoveries. Browser storage remains an evictable working copy, not a backup.

Lists load the 200 most recently changed records per collection. The active split, its routines, and recovery records are observed separately when outside that bound. Larger libraries need pagination in a later refinement.

## Workout logging and history

| Path under `users/{uid}`                               | Contents                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workoutSessions/{id}`                                 | Routine revision/name, exercise and planned-set snapshots, actual sets, session notes, elapsed time, saved rest-timer deadline, and lifecycle metadata |
| `workoutSessions/{id}/validationPages/p0` through `p3` | Internal bounded validation records, atomically written with each session revision                                                                     |
| `workoutState/current`                                 | Revision-checked pointer to the account's single active workout                                                                                        |

The [workout contracts](../src/types/workout.ts) and [strict runtime schemas](../src/schemas/workout.ts) separate planned targets from actual performance. Actual inputs start empty. The five tracking types are weight/reps, reps, assisted reps, duration, and distance/duration. Weight is stored in kilograms, distance in meters, and duration in seconds; displayed weight follows the account's kilogram/pound preference. RPE is optional, from 1 to 10. Only sets explicitly marked complete contribute to totals. Assistance is retained as assistance and excluded from external lifted volume.

Starting a routine copies its revision, name, exercises, planned sets, rest values, optional flags, and superset groups into a session. Later edits to the routine do not replace these snapshots. An explicit exercise substitution updates that session only and clears incomplete actuals; substitution is blocked once the entry has completed sets. Previous performance is matched by the exercise actually performed and includes only completed sets from the latest completed session within the loaded history. Ended-early sessions remain visible in history but are excluded from this previous-performance lookup.

Elapsed time is recovered from `startedAt`. The rest timer stores `timerEndAt`, recomputes the remaining interval after reload or background suspension, and does not write once per timer tick. Completing a set can start its configured rest. The timer supports adding 30 seconds and dismissal; it does not provide background alerts.

The lifecycle is `active` to `completed` or `abandoned`. Finishing requires at least one completed set; a confirmation describes partial completion and preserves incomplete entries. **End early** keeps the session and performed work as `abandoned`, including sessions without completed sets. Terminal sessions have an end timestamp, clear the timer, and cannot be updated or deleted through client rules. Completed sessions use their stable session ID as `completionKey`; duplicate finish submissions cannot create a second history identity. Starting and finishing update the session and active-workout pointer atomically. Revision ancestry rejects stale or competing writes; conflicting devices cannot silently replace the winning active session.

Each workout supports up to 20 exercises with 1 to 12 planned and actual sets per exercise. To stay within the Firestore expression budget, saves include one to four validation pages with at most five exercises each. Rules require the exact page concatenation and matching owner, session, revision, and mutation. Page writes are tied to a fresh parent revision; pages cannot be read, listed, deleted, or changed after terminal completion through client rules. Rules enforce lifecycle, metadata, pointer consistency, entry shape, snapshots' basic bounds, and set-list bounds. Individual planned/logged set fields, tracking-specific actuals, unique IDs, and remaining snapshot enums are enforced by strict client schemas on every read/write, rather than all being duplicated in rules. Direct administrative or custom-client writes can therefore store application-invalid nested values; the application reports validation errors instead of rendering them.

The history listener loads at most the 200 most recently changed sessions. Active sessions and recovery records outside that window are observed separately. There is no history pagination or terminal-history correction flow yet.

## Workout checkpoints and conflict recovery

The [workout provider](../src/services/workouts/WorkoutProvider.tsx) writes UID/session-scoped Dexie checkpoints before scheduling cloud writes. These records retain the editable session, base revision, interrupted write attempt, and conflict state until cloud acknowledgment. Newer edits are serialized behind pending attempts, including when the server snapshot arrives before the batch promise resolves. An offline start followed by offline completion keeps one session identity as the initial active write and terminal revision synchronize.

A per-UID Web Lock permits one workout writer per browser origin. Other tabs show the workout read only and provide **Retry synchronization** after the editing tab closes. A browser without Web Locks cannot safely edit workouts. Generation guards prevent a delayed save from a previous account from publishing its state in the next account's UI. Failed device writes keep the latest editor input visible, offer a retry, and guard navigation/sign-out; input that never reaches a checkpoint cannot survive a forced reload.

Rejected or conflicting cloud saves preserve the local checkpoint. Users can download workout recovery, retry synchronization, or explicitly select **Use cloud version** for a rejected record. Unconfirmed queued writes cannot be discarded through that action. Unreadable records can be downloaded before an explicit clear operation removes only malformed records for the current UID; usable checkpoints and other accounts' records remain. Recovery downloads are local diagnostic/recovery copies, not complete account exports or automatic imports.

## Planned scheduling and recovery data

Availability, dated session occurrences, sequence-slot tokens, advancement events, soreness inputs, and derived analytics remain future work. Completing a workout currently records history and clears the active-workout pointer; it does not advance the active split or recommend the next routine. Phase 4 must add explicit qualifying completion and unique sequence tokens so an old offline completion cannot advance a reset or newer cycle.

## Limitations

- Authentication, first approval, and uncached account setup need a connection.
- Browser storage can be evicted or manually cleared. Local drafts are not backups.
- iOS can suspend JavaScript. Workout timers recover from timestamps; background alerts are not implemented.
- WebKit automation does not certify physical iPhone installation, keyboard, backgrounding, or storage behavior.
- The current application has no adaptive recommendation engine, automatic split advancement, analytics, complete data export, account-deletion workflow, or terminal-history editing.
- Firestore quotas and Spark limits can interrupt service. Query/listener scope must remain bounded as features grow.
- The production build separates vendor chunks, but the Firebase SDK chunk still produces a size warning. Further bundle and loading optimization belongs to Phase 6.
- The owner reported deploying Phase 2. The agent has not published Phase 3; the updated workout client and compatible rules must be deployed together.
