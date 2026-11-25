# Architecture and data

## Account foundation

The client uses React, Vite, strict TypeScript, React Router, React Hook Form, Zod, Tailwind CSS, and selected Radix controls. Firebase Authentication provides email/password accounts. Firestore stores private profile data. Dexie stores recoverable onboarding drafts. Vite PWA generates the production asset cache and manifest.

| Layer        | Responsibility                                                       | Location                                             |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Application  | Routing, account gates, responsive shell                             | [app](../src/app/)                                   |
| Features     | Authentication, onboarding, profile, Today, upcoming-feature screens | [features](../src/features/)                         |
| Services     | Firebase initialization, account lifecycle, repository operations    | [services](../src/services/)                         |
| Validation   | Runtime profile and preferences validation                           | [schemas](../src/schemas/)                           |
| Types        | Stored account shape and preference defaults                         | [profile types](../src/types/profile.ts)             |
| Local drafts | Account-scoped onboarding input and step recovery                    | [draft storage](../src/features/onboarding/draft.ts) |

Routes wait for authentication resolution. An unapproved account sees the approval screen. An approved account with incomplete onboarding enters setup before the authenticated shell. Completed accounts can open Today, Plan, Train, Progress, Profile, and Settings. Plan manages routines and splits; Train links to saved routines. Workout logging and progress analytics remain upcoming features.

## Current database model

| Path                           | Contents                                                                                                                                        | Access                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `approvedUsers/{uid}`          | Administrator-maintained `active` boolean                                                                                                       | Owner may read their own document; clients cannot list or write |
| `users/{uid}`                  | `uid`, display name, onboarding status, schema version, integer creation/update timestamps                                                      | Approved owner may read and create/update                       |
| `users/{uid}/preferences/main` | Goals, units, timezone, experience, days, duration, mode, split, equipment, exercise preferences, recovery preference, optional initial history | Approved owner may read and create/update                       |

The profile and preferences are created and saved together in an atomic batch. Rules require both documents to exist after the write. Ownership and creation time are immutable, updates must advance the timestamp, and unrecognized fields or invalid preference combinations are rejected. Training collections have the additional rules described below. Other paths are denied. Client-side Zod validation adds form feedback and checks stored data before it reaches the UI.

Preference arrays use bounded, unique values. Preferred days and rest days cannot overlap; favorite and excluded exercises cannot overlap. Weekday values use Sunday `0` through Saturday `6`. Date-only initial training history remains a calendar date, separate from timestamp instants. Initial history is user-provided context, not a logged workout.

## Current offline behavior

Firestore persistent caching owns cloud-backed account data and pending writes. The interface distinguishes cached data and pending synchronization from cloud-confirmed data. Saving may complete locally while offline; cloud confirmation follows only after Firestore acknowledges it. Sign-out is blocked while changes are awaiting synchronization, and account transitions clear visible state, listeners, Firestore cache, and onboarding drafts before another account is used. Another open tab can prevent cache clearing and must be closed.

Onboarding drafts are stored in IndexedDB by UID, including the current step. Draft recovery preserves unfinished input, including fields that still need validation. These drafts are local convenience data, not a second cloud synchronization system.

Production builds precache application assets. The development server intentionally does not enable the service worker. Update prompts let users choose when to reload. Cached training configuration can be edited offline; workout logging remains Phase 3 work.

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

## Planned workout data and recovery

Future collections will be added alongside narrowly scoped rules and tests, rather than granting broad access now:

- Availability and dated session occurrences for scheduling.
- Workout sessions containing routine/exercise snapshots and performed sets.
- Training-state revisions, sequence-slot tokens, and advancement events for cycle continuity.
- Dated soreness/recovery inputs and derived, rebuildable analytics.

History snapshots will survive later routine edits. Session identifiers and completion operations must be idempotent. Partial and abandoned sessions preserve performed work; split advancement requires an explicit qualifying completion. Each sequence position receives a unique token so an old offline completion cannot advance a reset or newer cycle.

Firestore remains responsible for cloud synchronization. Dexie will add workout checkpoints until server acknowledgment, with timestamps for timer recovery. Workout save and cycle advancement will be acknowledged separately. Revision conflicts must preserve local work and explain recovery choices; Firestore last-write-wins behavior alone is insufficient for workout integrity. These guarantees are design requirements, not implemented Phase 1 features.

## Limitations

- Authentication, first approval, and uncached account setup need a connection.
- Browser storage can be evicted or manually cleared. Local drafts are not backups.
- iOS can suspend JavaScript; future timers must recover from timestamps, and background alerts cannot be guaranteed.
- WebKit automation does not certify physical iPhone installation, keyboard, backgrounding, or storage behavior.
- The current application has no workout logger, recommendation engine, analytics, complete data export, or account-deletion workflow.
- Firestore quotas and Spark limits can interrupt service. Query/listener scope must remain bounded as features grow.
- The production build separates vendor chunks, but the Firebase SDK chunk still produces a size warning at approximately 542 kB minified. Further bundle and loading optimization belongs to Phase 6.
- No deployment has been performed as part of Phase 1.
