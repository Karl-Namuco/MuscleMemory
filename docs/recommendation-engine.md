# Recommendation engine design

Status: Rolling scheduling and the initial Fixed calendar are implemented. Today and Train display the next eligible workout for either mode. Adaptive scoring, richer availability, and time adaptation remain planned; Phase 4 is not complete.

The [Rolling module](../src/domain/scheduling/rolling.ts) uses plain-data inputs and outputs, independent of React, Firebase, and browser APIs. Its split, routines, saved cursor, current instant, and account timezone determine the result. The future Adaptive engine will add versioned scoring and stable tie-breaking so identical inputs continue to produce identical results.

## Scheduling modes

| Mode     | Status      | Behavior                                                                                                          |
| -------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Fixed    | Implemented | A 28-day calendar with dated occurrences and explicit move, swap, and skip actions                                |
| Rolling  | Implemented | Continue the ordered split after the last qualifying completion, regardless of missed days or week boundaries     |
| Adaptive | Planned     | Compare feasible workouts using split continuity, recent training, availability, recovery, goals, and preferences |

For example, completing Push and missing two days still leaves Pull next in Rolling mode. A future Adaptive mode may propose a shorter Pull session if it fits the available time and constraints, with an explanation of the factors behind that proposal.

## Current Rolling scheduling

The recommendation identifies one exact split revision, training slot, routine, and sequence. It resumes after the cursor's last counted slot, traverses intervening rest slots, and wraps at the end of the split. Repeated uses of the same routine remain distinct slots. Unavailable or archived routines produce an explanation instead of silently skipping the slot.

Rest slots reserve complete local dates after the counted workout's completion day, using the account timezone. If `N` consecutive rest slots follow that workout, the next training date is `completedLocalDate + N + 1`. For example, a Monday completion followed by one rest slot permits Wednesday training. With no intervening rests, the next workout is available immediately. Leading rest slots do not delay the first workout of a new split revision. Users can select **Train early** and explicitly confirm an early scheduled start.

Starting the recommendation freezes its split ID, revision, slot ID, and sequence in the workout. Starting from the routine library creates a standalone workout, even if that routine also appears in the active split. Standalone workouts do not advance the cursor. Starting, resuming, and ending early do not consume a sequence token.

A scheduled workout counts automatically when its frozen planned sets have all been performed. Coverage includes optional entries and warmups; removing logged sets does not reduce the original plan. A partial completion requires the user to select **Count this workout toward my split**, which is initially unchecked. **End early** never counts. A completed workout must contain performed work, and it only counts while its active split, split revision, next slot, and sequence still match.

`workoutState/current` stores a `rollingProgress` cursor for each split: split revision, next sequence, last counted slot and session IDs, and completion timestamp. Terminal session history, clearing the active-workout pointer, and advancing the matching cursor are one atomic write. The durable checkpoint also retains the attempted state, so offline completion, reload, retry, and conflict recovery preserve the same token. Rules reject forged, duplicate, stale, or out-of-order cursor changes and preserve unrelated splits' progress. Historical workouts started before sequence tokens were introduced remain standalone for advancement purposes.

Switching active splits preserves each split's cursor. Editing a split starts the new revision at its first training slot. A workout for a split that changed or is no longer active can still save completed history without advancing it. There is no reset interface yet.

## Current Fixed scheduling

The [Fixed module](../src/domain/scheduling/fixed.ts) generates 28 inclusive calendar dates from the active Fixed split, a chosen start date, saved timezone, and selected training weekdays. Empty weekdays permit any day. Training slots advance only on selected weekdays; an intervening rest slot occupies the following calendar date. The calendar freezes its split revision and timezone, so travelling or changing account preferences does not silently shift its dates.

The calendar shows the current week and a separate list of missed training occurrences. The next-workout card prefers the oldest overdue training occurrence, then today's occurrence, then the next future occurrence. Passed dates never silently consume training. Users can move a planned occurrence to an unoccupied date within the window, swap two planned dates, or explicitly skip one. Completed occurrences remain immutable. Future workouts must be moved to an eligible date before starting them.

Each start freezes `fixedContext` with the schedule ID, generation ID, occurrence ID, and occurrence version, alongside the split/slot context. Full planned coverage counts automatically; partial coverage uses the same initially unchecked inclusion choice as Rolling. Ending early or completing standalone work leaves the occurrence planned. A qualifying finish atomically saves terminal history, clears the active-workout pointer, and marks exactly that occurrence completed. Its calendar payload is retained in the workout checkpoint's attempted write for offline acknowledgment and recovery.

Changing an occurrence, regenerating the calendar, or editing/deactivating the split invalidates the old completion token. History can still be saved without completing the changed occurrence. Creating the next calendar is explicit: a replacement confirmation warns that unresolved dates will be replaced and the split starts from its first slot. Completed workout history stays available. The initial calendar does not automatically extend beyond its 28-day window.

## Planned Adaptive pipeline

1. Validate preferences, history, date/timezone context, and the requested time budget.
2. Resolve dated occurrences and the current split position.
3. Calculate actual muscle exposure from performed sets.
4. Estimate recovery from workload, elapsed time, and optional soreness inputs.
5. Generate candidate workouts and apply hard equipment/exercise constraints.
6. Adapt each candidate to a realistic duration, including warm-up, rest, and setup.
7. Score feasible candidates and apply stable tie-breaking.
8. Return a recommendation, alternatives, contributing reasons, and proposed schedule changes.

Duration adjustment removes optional accessories before essential movements. If no reasonable session fits, the result should offer a suitable alternative or rest. It must not silently compress rest or invent an achievable duration.

Explanations come from contributing factors, for example: “Pull is next in your split; removing two optional accessories brings the estimate within 45 minutes.” Recovery labels remain qualitative, such as “Recently trained,” “Likely ready,” and “Insufficient data.” Missing soreness is unknown. Pain/injury inputs must be handled separately from ordinary soreness.

## Progression and overrides

Rolling advancement follows the qualification rules above. A long absence leaves the next slot intact and does not accumulate catch-up sessions. A future Adaptive flow may offer a manageable restart based on the user's constraints and recent training.

Fixed calendars implement explicit move, swap, and skip actions with revision and occurrence-version checks. Rolling repeat/skip/swap/reset controls and richer override history remain future work; a library workout remains standalone. Historical corrections will invalidate affected analytics and recommendations. Progressive-overload suggestions will require repeated eligible performance and remain user-editable.

## Required validation

Current Rolling checks cover missed days, local-calendar rest dates and boundaries, partial planned coverage, duplicate/stale completion, standalone sessions, split edits and switching, offline recovery, and deterministic selection. See [testing](./testing.md) for executed checks and limitations.

Fixed checks cover calendar generation and edits, frozen occurrence identity, timezone/week boundaries, partial inclusion, and offline completion. Remaining validation must cover future Rolling reset/override controls, Adaptive constraints, excluded equipment/exercises, insufficient history, impossible time budgets, and scoring explanations. Validate each future explanation against the factors that actually contributed to its score.
