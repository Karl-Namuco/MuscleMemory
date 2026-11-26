# Muscle Memory

An adaptive fitness PWA for desktop, tablet, and mobile, built around one question: “What should I train next?”

The application includes account access, training configuration, and Phase 3 workout logging: an exercise library, custom exercises, routine building with planned sets and supersets, editable split templates, ordered training/rest slots, an active-plan overview, and performed-set history. Account-scoped drafts and workout checkpoints support interruption recovery, offline saves, cloud confirmation, and explicit conflict recovery. Adaptive scheduling and analytics remain upcoming work.

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

## Use the application

1. Register, receive administrator approval, and complete onboarding.
2. In **Plan**, create a routine or add a split template. Adjust exercises and planned sets; make a split active if desired.
3. Open **Train**, choose **Start workout**, and enter the actual values for each set. Mark a set complete after performing it. Planned targets are shown separately and never become performed work automatically.
4. Resume an open workout from **Train** after leaving or reloading. Rest timers recover from their saved end time. Use one editing tab; other tabs remain read only until the writer closes and you select **Retry synchronization**.
5. Select **Finish workout** to save a completed session, or **End early** to preserve it as ended early. Both appear in **Workout history**. A partial finish requires confirmation; only checked sets contribute to totals.

Wait for **Changes synced** before relying on another device or signing out. **Saved on this device** means the workout still needs cloud confirmation. If a save is rejected, download workout recovery before choosing **Use cloud version**. Completing a workout does not yet advance the active split or generate a next-workout recommendation.

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

The application targets Firebase Authentication, Firestore, and standard Firebase Hosting on Spark. No paid backend or Cloud Functions are required. The owner reported deploying Phase 2. Phase 3 has not been published by the agent; rebuild and publish its compatible client and rules together. See [deployment](./docs/deployment.md).

## Design and roadmap

- [Architecture, data model, offline behavior, and limitations](./docs/architecture.md)
- [Recommendation engine design](./docs/recommendation-engine.md) — planned for Phase 4
- [Development roadmap](./docs/roadmap.md)
- [Testing](./docs/testing.md)

Adaptive recommendations, automatic split advancement, analytics, complete data export, and account deletion remain future phases. History currently loads the latest 200 changed sessions without pagination. Workout recovery downloads preserve local recovery records; they are not a complete account export. Browser storage is recoverable working state, not a guaranteed backup.
