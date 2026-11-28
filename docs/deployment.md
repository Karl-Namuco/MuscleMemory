# Firebase configuration and deployment

Status: the owner reported deploying Phase 2. Workout logging, Rolling scheduling, the initial Fixed calendar, inline custom exercises, and per-set weight-unit entry are implemented locally; the agent has not published them. Rebuild and deploy the compatible client and Firestore rules together before using these features on the hosted site. Calendar writes include bounded validation pages, and older installed clients need to refresh to understand the scheduling fields.

## Local development

Follow the [README](../README.md) for emulator startup. The default demo project is `demo-muscle-memory`, with loopback Authentication on port 9099, Firestore on 8080, and emulator UI on 4000. The approval helper always targets that local demo environment.

## Production project setup

Use a Firebase project on Spark with Authentication, Firestore, and standard Hosting. No Cloud Functions, paid AI, SMS authentication, or application media-storage service is required.

1. Register a Firebase web app and enable Email/Password authentication.
2. Create a Firestore database and choose its region deliberately before storing production data.
3. Copy [`.env.example`](../.env.example) to a local environment file. Set `VITE_USE_EMULATORS=false` and supply all six documented Firebase web config values.
4. Configure the intended Authentication authorized domains.
5. Review and validate [Firestore rules](../firestore.rules), [indexes](../firestore.indexes.json), and [Hosting configuration](../firebase.json).
6. Run the account, training configuration, and workout checks, rules tests, and browser tests. Build using the intended production environment and inspect the production bundle. Routine and workout writes include internal validation pages; publish the compatible client and rules together.
7. Confirm the intended project before publishing rules, indexes, or Hosting assets. A successful local build does not publish anything.

Vite embeds `VITE_` values into the client bundle. Firebase web configuration is public client configuration; never place service-account keys, administrator credentials, or other privileged secrets in those variables or the repository.

## Account approval

Registration creates an authentication identity only. Before the account can read or write its profile, an administrator must create `approvedUsers/{uid}` with `active: true` through Firebase Console or another trusted administrative environment. The UID comes from Firebase Authentication. The application cannot approve itself, list approved users, or modify approval records.

The local `npm run emulators:approve -- you@example.com` command is intentionally unable to change production approval records. Keep production administration out of browser code.

## Hosting and PWA

Hosting serves the generated `dist` directory and rewrites application routes to the entry page. Hashed assets receive immutable caching; the entry page and service worker use revalidation-friendly headers. The PWA manifest includes standard and maskable icons. Production service workers require a secure context, normally HTTPS; localhost is suitable for local preview.

Build and inspect locally before any deployment:

```powershell
npm run build
npm run preview
```

A production build must use the real configuration with emulators disabled. Missing configuration displays a setup screen rather than pretending account data can be saved.

For an initial deployment, sign in to Firebase, select the intended real project, rebuild with its configuration, and publish:

```powershell
npx firebase login
npx firebase use --add
npm run build
npx firebase deploy --only "firestore:rules,firestore:indexes,hosting"
```

`firebase use --add` prompts for a project and an alias. Verify that the selected project matches `VITE_FIREBASE_PROJECT_ID` before continuing. The agent has not executed these production publishing commands for Phase 3.

For an existing deployment, keep its project selection and environment configuration, rebuild, and publish the new client and compatible rules:

```powershell
npm run build
npx firebase deploy --only "firestore:rules,firestore:indexes,hosting"
```

Phase 3 adds private `users/{uid}/workoutSessions/{id}` documents, one to four bounded validation pages per workout revision, and `users/{uid}/workoutState/current`. Existing Phase 2 rules deny these new paths. Publishing only the new Hosting assets causes workout saves to be rejected until the matching rules are live. No backfill of existing routines, splits, or profiles is required for these new collections.

After publishing, refresh or accept the application's update prompt to load the new client. Verify registration/approval, onboarding/profile persistence, route refreshes, cache/update behavior, and sign-out. For workouts, start a routine, enter actuals and check a set, reload to verify actuals/timer recovery, finish or end early, confirm **Changes synced**, and inspect history. Confirm another tab is read only while one tab owns workout editing. A local checkpoint or recovery download alone does not establish that a save reached the production backend.

Physical iPhone installation, background/resume behavior, keyboards, and production service-worker behavior still need device testing over HTTPS. The owner-reported earlier deployment does not certify the updated Phase 3 release or those checks.

## Cost and operational limits

The intended personal deployment stays on Spark and has no paid backend requirement. Free quotas are finite and can change; check the project's current Firebase Console quotas before launch. Workout saves write the session plus one to four validation pages; lifecycle transitions also write the active-workout pointer. Rest timer ticks do not trigger database writes. Current configuration lists and workout history are bounded to 200 recently changed records; history pagination remains future work. Review usage as features grow. Quota exhaustion may interrupt service rather than transparently expanding capacity.

Complete account exports and resumable account deletion are planned for Phase 6. Workout recovery downloads contain local checkpoints and are not complete exports or an account-deletion workflow.
