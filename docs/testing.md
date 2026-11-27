# Testing

Test files and commands describe repeatable checks. A passing result must be observed from execution; this document does not certify that every check has passed on a particular machine or commit.

## Initial Rolling scheduling verification on 2026-11-27

The first Phase 4 increment adds Rolling recommendations and qualifying split advancement. Fixed and Adaptive scheduling remain planned.

Executed checks: all 161 unit/component tests across 11 files and all 43 Firestore emulator rules tests passed. TypeScript checking and the production build passed with PWA generation caching 55 entries.

The full Playwright suite passed all 12 runnable cases, with the 2 existing WebKit adverse-concurrency cases intentionally skipped (14 total). It covered seven desktop Chromium cases and five iPhone-sized WebKit cases. Narrow recommendation/rest screenshots were inspected; the active split recommendation was then moved directly below the Today greeting and the focused Rolling flow was rechecked on both browsers.

- [Scheduling domain tests](../tests/rolling-scheduling.test.ts) cover deterministic selection, missed days and long breaks, repeated routine slots, wrapping, split revisions, unavailable routines, local-calendar rest dates across timezones and DST, planned-set coverage, and stale/duplicate/out-of-order sequence tokens.
- [Workout provider tests](../tests/workout-provider.test.tsx) cover atomic cursor/history writes, repeated routine slots, partial inclusion choices, standalone and ended-early sessions, offline completion before the initial active write, and retaining completion intent while training data is loading, pending, or rejected. A reload regression test verifies that a terminal checkpoint waits for its split to hydrate before resolving advancement.
- [Workout UI tests](../tests/workouts.test.tsx) cover recommendation starts, explicit early-rest confirmation, synchronization/read-only guards, partial inclusion defaulting to unchecked, changed splits, and preserving consent while the plan is unresolved.
- [Workout rules tests](../tests/workouts.rules.test.ts) verify that only the expected frozen slot/sequence advances, terminal history and progress change atomically, unrelated cursors remain intact, legacy sessions remain valid, and forged/stale changes fail. The maximum 20-exercise/12-set counted workout and 12-slot rest traversal also pass.
- [Rolling browser flow](../tests/e2e/rolling-scheduling.spec.ts) exercises real checkpoint and backend behavior: full completion offline, reconnecting once, repeated routines after reload, partial no-count and opt-in, rest recommendations, and an explicit early start ended without advancement. It checks 320 px layout overflow and captures recommendation/rest screenshots.

Playwright's spawned development server explicitly uses loopback Firebase emulators regardless of the local environment file. When reusing an already-running server, start that server in emulator mode too. The Rolling WebKit flow records narrowly matched canceled loopback Auth lookup or Firestore channel diagnostics only during explicit navigation/offline transitions; all other page errors fail. Backend state and persistence assertions remain required.

No production deployment or physical-device installation is implied. The existing approximately 548 kB Firestore SDK chunk warning remains. Production service-worker behavior was not re-certified for this increment.

## Workout logging verification on 2026-11-26

The resumed Phase 3 implementation passed the following executed checks. Earlier Phase 2 results below describe that earlier implementation.

- All 107 unit/component tests across 10 files and all 34 Firestore emulator rules tests passed. A separate isolated foundation-rules rerun also passed its 9 tests.
- ESLint, TypeScript checking, and the production build passed after the recovery-export readiness fix. PWA generation cached 55 entries. The existing approximately 548 kB Firestore SDK chunk warning remains.
- The final full Playwright run passed all 10 executed browser cases, with 2 intentional mobile WebKit adverse-concurrency skips out of 12 total cases. It completed in 3.7 minutes across desktop Chromium and mobile WebKit, covering account setup, training configuration, workout interruption/offline completion, history, and desktop conflict/tab recovery.
- A Chromium smoke check of a production-mode PWA using local Firebase emulators passed: the service worker cached the application shell; offline active-workout reload preserved actuals and the rest timer; the workout finished offline; an offline history reload retained the finished work; reconnecting created exactly one completed backend session and cleared the active pointer. No page errors were observed. This verifies the production asset-cache path against local emulators, not production Firebase connectivity or physical iPhone behavior.

An earlier WebKit foundation run timed out during a stalled emulator Firestore profile-write request. The unchanged isolated rerun and final full suite passed. Existing timeouts and persistence assertions were retained.

- [Workout domain tests](../tests/workout-domain.test.ts) exercise all five tracking types, actual-set validation, snapshot isolation, substitutions, completed-only totals and previous performance, timestamp-based timers, bounded validation pages, and checkpoint/state schemas.
- [Workout component tests](../tests/workouts.test.tsx) cover start/resume, duplicate submissions, input types and pound conversion, explicit set completion, substitutions before performance, set bounds/removal, partial-finish confirmation, ended-early history, rest-deadline recovery, live-snapshot preservation, device-save failure/retry, and read-only secondary tabs.
- [Workout provider tests](../tests/workout-provider.test.tsx) exercise recovery exports from hydrated account records while cloud snapshots are loading, delayed writes across account switches, newer edits arriving around server acknowledgment, preservation of newer cloud snapshots when an older acknowledgment waits behind a device checkpoint, and offline completion before the first cloud acknowledgment without creating a second session identity.
- [Workout rules tests](../tests/workouts.rules.test.ts) cover approval/ownership isolation, bounded history, atomic start/finish and active-pointer consistency, terminal immutability, competing starts, stale revisions, matching validation pages, lifecycle bounds, maximum 20-exercise/12-set sessions, all tracking types, and denied deletion.
- [Workout browser flow](../tests/e2e/workouts.spec.ts) checks real device checkpoints and backend actuals, reload/timer recovery, frozen snapshots after routine edits, offline completion and cloud confirmation, previous performance, ended-early history, and desktop/tablet/mobile/narrow-screen overflow.
- [Workout recovery browser tests](../tests/e2e/workout-recovery.spec.ts) check secondary-tab locking and takeover, plus competing offline browser contexts whose rejected actuals survive reload and recovery download until an explicit cloud-version choice. These adverse concurrency cases run in desktop Chromium; their two mobile WebKit variants are intentionally skipped. The primary workout flow runs on both browser projects.

Cloud acknowledgment is asserted separately from local checkpoint success. Automated browser checks do not certify production Firebase connectivity, physical iPhone behavior, background alerts, or recovery from operating-system storage eviction. The production-mode offline smoke check above covers cached Chromium reloads with local emulators; production hosting and real-device checks remain separate. At that Phase 3 checkpoint, completing a workout did not advance a split; the initial Rolling checks above cover the subsequent increment.

## Training configuration verification on 2026-11-25

- Lint, all 49 unit/component tests, TypeScript checking, and the production build passed. Unit test files run serially to keep DOM-heavy component checks reliable on the development machine.
- All 22 Firestore emulator rules tests passed. Coverage includes ownership/approval, revision conflicts, atomic active-split deactivation, maximum 20-exercise/12-set routines and 12-slot splits, invalid final entries, and rejection of missing or mismatched validation pages.
- All 6 browser tests passed across desktop Chromium and mobile WebKit. The new training flow creates an exercise and routine, recovers a reordered split draft, activates a split, verifies the Plan overview, saves while offline and confirms synchronization, archives/restores a split while preserving its routines, and adds a template.
- Desktop, tablet (834 px), mobile, and 320 px split-editor screenshots were inspected. Horizontal overflow assertions passed, including a 120-character split name. Dialog focus restoration and starting a fresh split after a confirmed creation were checked.
- The existing approximately 548 kB Firestore SDK bundle warning remains; the production build and PWA generation succeed.
- No production deployment or physical-device installation test was performed.

The [training browser test](../tests/e2e/training.spec.ts), [split component tests](../tests/splits.test.tsx), [routine tests](../tests/routines.test.tsx), [exercise tests](../tests/exercises.test.tsx), [domain tests](../tests/training-domain.test.ts), and [training rules tests](../tests/training.rules.test.ts) contain the repeatable checks. Client writes include bounded validation records atomically with each full routine; the rules suite exercises both the valid path and attempts to bypass it.

## Earlier foundation verification on 2026-11-25

- `npm run check`: lint, 21 unit/component tests, TypeScript, and production build passed.
- Firestore emulator rules suite: 9 tests passed, including approval enforcement, cross-user isolation, all supported exercise-name entries, and atomic onboarding saves.
- `npm run test:e2e`: all 4 tests passed across desktop Chromium and iPhone-sized WebKit. This includes registration, approval, five-step onboarding, draft recovery after reload, saved preferences after reload, profile editing, navigation, and sign-out.
- Desktop and mobile onboarding, Today, and profile screenshots were inspected. Narrow-screen registration overflow checks passed.
- `npm audit --omit=dev`: no production dependency advisories. The full audit reports 15 moderate advisories in development-tool dependencies (Firebase CLI/Workbox and their transitive packages), with no high or critical findings. These remain open; no forced downgrades were applied.
- Production preview: SPA route fallback, the missing-configuration guard, manifest, and application icon dimensions/URLs passed.
- Physical iPhone installation, standalone behavior, real-device keyboards/backgrounding, and production Firebase connectivity have not been tested.

The production build emits a warning for the approximately 543 kB Firestore SDK chunk. The build succeeds; further performance refinement remains Phase 6 work.

| Command              | Purpose                                                | Prerequisites                                                                        |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `npm run lint`       | ESLint checks                                          | Installed dependencies                                                               |
| `npm run test`       | Unit and component tests                               | Installed dependencies                                                               |
| `npm run build`      | TypeScript check and production bundle/PWA generation  | Installed dependencies                                                               |
| `npm run test:rules` | Firestore authorization and schema tests               | Java available; port 8080 free                                                       |
| `npm run test:e2e`   | Browser account, training, workout, and recovery flows | Authentication and Firestore emulators running; Playwright Chromium/WebKit installed |

`npm run check` combines lint, unit tests, and build. Rules and browser tests remain separate because they have emulator requirements.

## Foundation coverage

- [Authentication UI tests](../tests/auth-ui.test.tsx): labeled forms and validation feedback.
- [Onboarding tests](../tests/onboarding.test.tsx): step transitions, editable preferences, and draft-related behavior.
- [Profile schema tests](../tests/profile-schema.test.ts): preference validation and invalid combinations.
- [Firestore rules tests](../tests/firestore.rules.test.ts): approval enforcement, ownership isolation, document validation, and denied client privilege changes.
- [Browser tests](../tests/e2e/foundation.spec.ts): registration, pending approval, administrator approval, onboarding, reload persistence, profile edits, navigation, sign-out, and narrow-screen overflow checks.

Browser tests use desktop Chromium and an iPhone 13 Pro Max WebKit device profile. They create unique test accounts and approve them through the local emulator administrator API, not through client rules. They start or reuse Vite at `127.0.0.1:5173`. Failed tests retain traces and screenshots; reports and results are ignored by Git.

Rules tests start their own Firestore emulator and stop it afterward. Stop a development emulator before running them, then restart both development emulators for browser tests.

WebKit reports cancelled Firestore fetches as errors when leaving a document. The browser test retains these as a JSON attachment only when the exact local Firestore channel signature occurs inside an explicit awaited reload or sign-out navigation. The sign-out window ends after the login URL and heading are confirmed. Every other page error, including the same message during normal use, fails the test. This follows the [Firebase maintainer explanation](https://github.com/firebase/firebase-js-sdk/issues/3708); cloud-confirmed saves and post-reload persistence are still asserted.

The training browser test retains the same exact local-channel diagnostic during its explicit document navigations and intentional offline/reconnect interval. Other page errors still fail. The test confirms that recovery records disappear and the backend receives the edited split after reconnecting. The workout browser flow applies its explicit reload/offline-transition diagnostic window while asserting persisted actuals and final backend status.

## Manual checks before release

Inspect desktop and iPhone-sized authentication, all onboarding steps, Today, Plan, Train, Progress, Profile, Settings, dialogs, and error/approval states. Check touch targets, keyboard focus, labels, contrast, reduced motion, long names, numeric fields, and horizontal overflow.

Use a production build to inspect service-worker updates and cached assets. Use a physical iPhone over HTTPS to check Safari, Add to Home Screen, safe areas, virtual keyboards, reload/background behavior, and storage recovery. Physical-device testing remains outstanding; simulated WebKit is not a substitute.

Workout interruption/recovery, offline completion, rejected/conflicting writes, and duplicate-submission behavior have the Phase 3 checks described above. Initial Rolling calendar boundaries, sequence advancement, and deterministic selection have the additional checks above. Fixed calendar actions, Adaptive scoring, availability, and future overrides still require their own implementation and validation.
