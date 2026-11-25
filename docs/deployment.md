# Firebase configuration and deployment preparation

Status: configuration is prepared; deployment has not been authorized or performed.

## Local development

Follow the [README](../README.md) for emulator startup. The default demo project is `demo-muscle-memory`, with loopback Authentication on port 9099, Firestore on 8080, and emulator UI on 4000. The approval helper always targets that local demo environment.

## Production project setup

Use a Firebase project on Spark with Authentication, Firestore, and standard Hosting. No Cloud Functions, paid AI, SMS authentication, or application media-storage service is required.

1. Register a Firebase web app and enable Email/Password authentication.
2. Create a Firestore database and choose its region deliberately before storing production data.
3. Copy [`.env.example`](../.env.example) to a local environment file. Set `VITE_USE_EMULATORS=false` and supply all six documented Firebase web config values.
4. Configure the intended Authentication authorized domains.
5. Review and validate [Firestore rules](../firestore.rules), [indexes](../firestore.indexes.json), and [Hosting configuration](../firebase.json).
6. Run the account and training configuration checks, rules tests, and browser tests. Build using the intended production environment and inspect the production bundle. Routine writes include internal validation pages; publish the compatible client and rules together.
7. Obtain deployment approval before publishing rules, indexes, or Hosting assets.

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

Only after deployment approval, sign in to Firebase, select the intended real project, rebuild with its configuration, and publish:

```powershell
npx firebase login
npx firebase use --add
npm run build
npx firebase deploy --only firestore:rules,firestore:indexes,hosting
```

`firebase use --add` prompts for a project and an alias. Verify that the selected project matches `VITE_FIREBASE_PROJECT_ID` before continuing. These commands are instructions for a future approved deployment; they have not been executed as part of this release.

After an approved deployment, verify registration/approval, onboarding and profile persistence, route refreshes, cache/update behavior, sign-out, and physical iPhone installation. Do not report deployment success from a build alone.

## Cost and operational limits

The intended personal deployment stays on Spark and has no paid backend requirement. Free quotas are finite and can change; check the project's current Firebase Console quotas before launch. Bound listeners, paginate future history, avoid timer-driven database writes, and review usage as features grow. Quota exhaustion may interrupt service rather than transparently expanding capacity.

Exports and resumable account deletion are planned for Phase 6 and are not available in the foundation release. Do not promise self-service data removal until that workflow is implemented and tested.
