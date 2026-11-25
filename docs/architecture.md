# Architecture and data

## Phase 1 implementation

The client uses React, Vite, strict TypeScript, React Router, React Hook Form, Zod, Tailwind CSS, and selected Radix controls. Firebase Authentication provides email/password accounts. Firestore stores private profile data. Dexie stores recoverable onboarding drafts. Vite PWA generates the production asset cache and manifest.

| Layer        | Responsibility                                                       | Location                                             |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Application  | Routing, account gates, responsive shell                             | [app](../src/app/)                                   |
| Features     | Authentication, onboarding, profile, Today, upcoming-feature screens | [features](../src/features/)                         |
| Services     | Firebase initialization, account lifecycle, repository operations    | [services](../src/services/)                         |
| Validation   | Runtime profile and preferences validation                           | [schemas](../src/schemas/)                           |
| Types        | Stored account shape and preference defaults                         | [profile types](../src/types/profile.ts)             |
| Local drafts | Account-scoped onboarding input and step recovery                    | [draft storage](../src/features/onboarding/draft.ts) |

Routes wait for authentication resolution. An unapproved account sees the approval screen. An approved account with incomplete onboarding enters setup before the authenticated shell. Completed accounts can open Today, Plan, Train, Progress, Profile, and Settings. Plan, Train, and Progress currently display saved preferences and clear descriptions of upcoming functionality.

## Current database model

| Path                           | Contents                                                                                                                                        | Access                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `approvedUsers/{uid}`          | Administrator-maintained `active` boolean                                                                                                       | Owner may read their own document; clients cannot list or write |
| `users/{uid}`                  | `uid`, display name, onboarding status, schema version, integer creation/update timestamps                                                      | Approved owner may read and create/update                       |
| `users/{uid}/preferences/main` | Goals, units, timezone, experience, days, duration, mode, split, equipment, exercise preferences, recovery preference, optional initial history | Approved owner may read and create/update                       |

The profile and preferences are created and saved together in an atomic batch. Rules require both documents to exist after the write. Ownership and creation time are immutable, updates must advance the timestamp, and unrecognized fields or invalid preference combinations are rejected. All other paths are denied. Client-side Zod validation adds form feedback and checks stored data before it reaches the UI; it does not replace database rules.

Preference arrays use bounded, unique values. Preferred days and rest days cannot overlap; favorite and excluded exercises cannot overlap. Weekday values use Sunday `0` through Saturday `6`. Date-only initial training history remains a calendar date, separate from timestamp instants. Initial history is user-provided context, not a logged workout.

## Current offline behavior

Firestore persistent caching owns cloud-backed account data and pending writes. The interface distinguishes cached data and pending synchronization from cloud-confirmed data. Saving may complete locally while offline; cloud confirmation follows only after Firestore acknowledges it. Sign-out is blocked while changes are awaiting synchronization, and account transitions clear visible state, listeners, Firestore cache, and onboarding drafts before another account is used. Another open tab can prevent cache clearing and must be closed.

Onboarding drafts are stored in IndexedDB by UID, including the current step. Draft recovery preserves unfinished input, including fields that still need validation. These drafts are local convenience data, not a second cloud synchronization system.

Production builds precache application assets. The development server intentionally does not enable the service worker. Update prompts let users choose when to reload. The PWA shell does not yet provide offline workouts: routines and workout logging are Phase 2 and Phase 3 work.

## Planned workout data and recovery

Future collections will be added alongside narrowly scoped rules and tests, rather than granting broad access now:

- Custom exercises, routines, and splits for training configuration.
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
- The current application has no workout logger, routine builder, recommendation engine, analytics, export, or account-deletion workflow.
- Firestore quotas and Spark limits can interrupt service. Query/listener scope must remain bounded as features grow.
- The production build separates vendor chunks, but the Firebase SDK chunk still produces a size warning at approximately 542 kB minified. Further bundle and loading optimization belongs to Phase 6.
- No deployment has been performed as part of Phase 1.
