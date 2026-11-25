# Recommendation engine design

Status: planned for Phase 4. Phase 1 stores the user's preferred scheduling mode; it does not calculate or display a real workout recommendation.

The engine will be a pure TypeScript module with plain-data inputs and outputs, independent of React, Firebase, and browser APIs. A clock/timezone context, versioned scoring configuration, and stable tie-breaking must make identical inputs produce identical results.

## Scheduling modes

| Mode     | Intended behavior                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Fixed    | Follow dated occurrences and offer explicit move, swap, skip, or reschedule actions                               |
| Rolling  | Continue the ordered split after the last qualifying completion, regardless of missed days or week boundaries     |
| Adaptive | Compare feasible workouts using split continuity, recent training, availability, recovery, goals, and preferences |

For example, completing Push and missing two days still leaves Pull next in Rolling mode. Adaptive mode may propose a shorter Pull session if it fits the available time and constraints. It must explain the factors behind that proposal.

## Pipeline

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

Starting or abandoning a workout does not advance a split. A partial completion asks whether it should count. Unscheduled sessions only advance the intended slot or require explicit confirmation. A long absence offers a manageable restart without accumulated catch-up volume.

Overrides are explicit events, including repeat, skip, swap, reset, and selecting another workout. Session completion and cycle advancement use stable identifiers and sequence-slot tokens. Historical corrections invalidate affected analytics and recommendations. Progressive-overload suggestions require repeated eligible performance and remain user-editable.

## Required validation

Cover missed days, rest days, week boundaries, partial sessions, duplicate completion, unscheduled sessions, split edits/resets, long breaks, timezone changes, excluded equipment/exercises, insufficient history, impossible time budgets, and deterministic outputs. Validate the explanation against the actual scoring factors so it cannot become decorative copy.
