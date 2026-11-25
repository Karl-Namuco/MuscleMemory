# Muscle Memory

An iPhone-first fitness PWA built around one question: “What should I train next?”

Version 0.1 implements the Phase 1 foundation: private email/password accounts, administrator approval, five-step onboarding with local draft recovery, editable profile preferences, responsive navigation, and an initial production PWA shell. Plan, Train, and Progress explain upcoming features; they do not schedule or log workouts yet.

## Run locally

Use a supported even-numbered Node.js LTS release (Node 24 recommended), npm, and Java 21 or later for the Firestore emulator. The package engine range is `^22.13.0 || ^24.0.0 || >=26.0.0`. Dependencies are pinned in [package-lock.json](./package-lock.json).

```powershell
npm ci
Copy-Item .env.example .env
```

In one terminal, start the local Firebase Authentication and Firestore emulators:

```powershell
npm run emulators
```

In another terminal, start the application:

```powershell
npm run dev
```

Open the local URL printed by Vite, normally <http://127.0.0.1:5173>. Register an account, then approve it from a third terminal:

```powershell
npm run emulators:approve -- you@example.com
```

Return to the application to complete onboarding. The approval helper is restricted to the loopback emulators and the `demo-muscle-memory` project; it cannot approve production accounts. Local emulator data is temporary unless you separately configure emulator export/import. The emulator interface is available at <http://127.0.0.1:4000>.

Never expose the emulator ports to an untrusted network. Emulator administrative access is intended for local development, not as an application authorization mechanism.

## Checks

```powershell
npm run lint
npm run test
npm run build
```

For database authorization tests, stop any existing Firestore emulator first so port 8080 is free:

```powershell
npm run test:rules
```

For browser tests, start both emulators, install Playwright browsers if necessary, and run:

```powershell
npx playwright install chromium webkit
npm run test:e2e
```

Playwright starts or reuses the Vite development server and runs desktop Chromium and iPhone-sized WebKit flows. See [testing](./docs/testing.md) for scope and physical-device limitations.

## Configuration and deployment

Development defaults to emulators. [`.env.example`](./.env.example) documents the public Firebase web configuration for a real project. Production access requires an administrator-created `approvedUsers/{uid}` document with `active: true`; registration alone grants no private database access.

The application targets Firebase Authentication, Firestore, and standard Firebase Hosting on Spark. No paid backend or Cloud Functions are required. Hosting configuration is prepared, but deployment is a separate approval step. See [deployment](./docs/deployment.md).

## Design and roadmap

- [Architecture, data model, offline behavior, and limitations](./docs/architecture.md)
- [Recommendation engine design](./docs/recommendation-engine.md) — planned for Phase 4
- [Development roadmap](./docs/roadmap.md)
- [Testing](./docs/testing.md)

Workout logging, routines, adaptive recommendations, analytics, data export, and account deletion remain future phases. Browser storage is recoverable working state, not a guaranteed backup.
