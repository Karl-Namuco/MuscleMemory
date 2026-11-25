# Testing

Test files and commands describe repeatable checks. A passing result must be observed from execution; this document does not certify that every check has passed on a particular machine or commit.

## Verification on 2026-11-25

- `npm run check`: lint, 21 unit/component tests, TypeScript, and production build passed.
- Firestore emulator rules suite: 9 tests passed, including approval enforcement, cross-user isolation, all supported exercise-name entries, and atomic onboarding saves.
- `npm run test:e2e`: all 4 tests passed across desktop Chromium and iPhone-sized WebKit. This includes registration, approval, five-step onboarding, draft recovery after reload, saved preferences after reload, profile editing, navigation, and sign-out.
- Desktop and mobile onboarding, Today, and profile screenshots were inspected. Narrow-screen registration overflow checks passed.
- `npm audit --omit=dev`: no production dependency advisories. The full audit reports 15 moderate advisories in development-tool dependencies (Firebase CLI/Workbox and their transitive packages), with no high or critical findings. These remain open; no forced downgrades were applied.
- Production preview: SPA route fallback, the missing-configuration guard, manifest, and application icon dimensions/URLs passed.
- Physical iPhone installation, standalone behavior, real-device keyboards/backgrounding, and production Firebase connectivity have not been tested.

The production build emits a warning for the approximately 543 kB Firestore SDK chunk. The build succeeds; further performance refinement remains Phase 6 work.

| Command              | Purpose                                               | Prerequisites                                                                        |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run lint`       | ESLint checks                                         | Installed dependencies                                                               |
| `npm run test`       | Unit and component tests                              | Installed dependencies                                                               |
| `npm run build`      | TypeScript check and production bundle/PWA generation | Installed dependencies                                                               |
| `npm run test:rules` | Firestore authorization and schema tests              | Java available; port 8080 free                                                       |
| `npm run test:e2e`   | Browser account/setup/navigation flow                 | Authentication and Firestore emulators running; Playwright Chromium/WebKit installed |

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

## Manual checks before release

Inspect desktop and iPhone-sized authentication, all onboarding steps, Today, Plan, Train, Progress, Profile, Settings, dialogs, and error/approval states. Check touch targets, keyboard focus, labels, contrast, reduced motion, long names, numeric fields, and horizontal overflow.

Use a production build to inspect service-worker updates and cached assets. Use a physical iPhone over HTTPS to check Safari, Add to Home Screen, safe areas, virtual keyboards, reload/background behavior, and storage recovery. Physical-device testing remains outstanding; simulated WebKit is not a substitute.

Future workout and recommendation phases require meaningful tests for interruption/recovery, offline completion, rejected/conflicting writes, duplicate completion, calendar boundaries, and deterministic recommendations. Do not interpret foundation checks as coverage for those unimplemented features.
