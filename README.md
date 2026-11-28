# Muscle Memory

An adaptive fitness PWA for desktop, tablet, and mobile, built around one question: “What should I train next?”

The application includes account access, training configuration, reliable workout logging, and Rolling and Fixed recommendations on Today and Train. Rolling keeps the next workout in place after missed days; Fixed uses a dated 28-day calendar with explicit move, swap, and skip actions. The 69-exercise library, inline custom exercise creation, routine builder, split templates, and performed-set history support the full training flow. Account-scoped drafts and workout checkpoints preserve interruption recovery, offline saves, cloud confirmation, and explicit conflict recovery. Adaptive scoring and analytics remain upcoming work.

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
2. In **Plan**, create a routine or add a split template. **Add exercise** includes **Create your own exercise**: enter its name, equipment, tracking type, and primary muscle to save it to your library and add it immediately to the routine. Adjust planned sets and make a split active if desired. For Fixed mode, open **Calendar**, choose its start date and preferred training weekdays, then create its 28-day calendar using your account timezone.
3. Open **Today** or **Train** and start the recommended workout for your active Rolling or Fixed split. Routine-library **Start workout** actions start standalone sessions that do not advance the split. Enter actual values and mark each set complete after performing it; planned targets never become performed work automatically. Each weight or assistance input has its own **kg/lb** selector. Entering pounds automatically stores the converted kilograms and shows the conversion; changing the selector changes the displayed unit without changing the saved weight. Your account unit preference continues to control planned targets and history.
4. Resume an open workout from **Train** after leaving or reloading. Rest timers recover from their saved end time. Use one editing tab; other tabs remain read only until the writer closes and you select **Retry synchronization**.
5. Select **Finish workout** to save a completed session, or **End early** to preserve it as ended early. Both appear in **Workout history**. Completing every planned set in a scheduled workout counts automatically. A partial finish counts only if you select **Count this workout toward my split**, which starts unchecked. Optional exercises and warmups remain part of the frozen plan; removing logged sets does not reduce that plan. **End early** never advances the split, and only performed sets contribute to totals.

Rolling rest slots reserve full local calendar days after a counted completion. One rest slot after Monday's workout makes Wednesday the next training date; without rest slots, the next workout is available immediately. The recommendation offers an explicit **Train early** confirmation. Switching splits preserves each split's progress; editing a split restarts its current revision at the first training slot. Existing workouts started before sequence tokens were added do not advance a split.

Fixed calendars preserve their chosen timezone across device travel and preference changes. Missed workouts stay on their assigned dates until you explicitly move, swap, or skip them; other calendar dates stay in place. Use **Calendar** to review all 28 days and adjust planned workouts. A scheduled completion resolves its exact calendar occurrence; changing that occurrence, calendar generation, or split revision prevents a stale workout from changing the calendar. Completed workout history stays intact. Create a new calendar when the current window ends or after changing the split structure.

Wait for **Changes synced** before relying on another device or signing out. **Saved on this device** means the workout still needs cloud confirmation. If a save is rejected, download workout recovery before choosing **Use cloud version**. A scheduled workout counts only while its matching split, revision, and next slot remain active; other completions still preserve performed history.

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

The application targets Firebase Authentication, Firestore, and standard Firebase Hosting on Spark. No paid backend or Cloud Functions are required. The owner reported deploying Phase 2. The agent has not published Phase 3 or these Phase 4 increments. Rebuild and publish the compatible client and rules together, and refresh older installed clients for the new scheduling and per-set weight-unit fields. See [deployment](./docs/deployment.md).

## Design and roadmap

- [Architecture, data model, offline behavior, and limitations](./docs/architecture.md)
- [Rolling and Fixed scheduling behavior and planned recommendation engine](./docs/recommendation-engine.md)
- [Development roadmap](./docs/roadmap.md)
- [Testing](./docs/testing.md)

Adaptive recommendations and scoring, time adaptation, repeat/reset overrides, analytics, complete data export, and account deletion remain future work. History currently loads the latest 200 changed sessions without pagination or terminal-history corrections. Workout recovery downloads preserve local recovery records; they are not a complete account export. Browser storage is recoverable working state, not a guaranteed backup.
