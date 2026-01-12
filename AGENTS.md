# AGENTS.md — RaceGame (Canni-DEV)

This repository contains (at least) two TypeScript codebases:
- `online-car-race-3d/` (front-end client / Three.js)
- `race-backend/` (server / game logic + networking)

Primary goals for any AI agent working on this repo:
1) Preserve existing style and architecture.
2) Keep backward compatibility (runtime behavior, public APIs, event names, message schemas).
3) Never introduce large changes without proposing them first.

---

## 0) Non-negotiable Rules (Read First)

### Proposal-First for Large Changes
If a change would be considered “large”, you MUST:
1) Produce a short **proposal** (bullets) describing:
   - what you will change,
   - why,
   - impacted modules/files,
   - risks,
   - migration steps (if any),
   - how you’ll validate (build/run/tests).
2) Wait for explicit confirmation from the user before implementing.

Large change examples (non-exhaustive):
- Architectural refactors (moving responsibilities across modules, introducing new layers, big folder reshuffles).
- Changing network protocol / socket event names / payload schemas.
- Replacing libraries, build tooling, bundler, or major dependencies.
- “Cleanup” refactors across many files that aren’t directly required by the task.

### Compatibility is Mandatory
- Do not break existing runtime behavior.
- Do not rename public exports, event names, URL paths, CLI commands, or config keys unless explicitly requested.
- If adding fields to network payloads, do so in a backward compatible way (optional fields, defaults).

### Preserve Style, Don’t “Normalize”
- Do NOT apply global formatting changes or “style unification” across the repo unless explicitly asked.
- Follow the existing patterns in each subproject:
  - coding style,
  - folder structure,
  - naming conventions,
  - error handling patterns,
  - logging style.

### Minimal Surface Area
- Prefer smallest possible change set to achieve the requested outcome.
- Prefer additive changes over rewrites.
- Avoid changing unrelated code “because it looks better”.

---

## 1) Repo Orientation & Boundaries

### Subprojects
- `online-car-race-3d/`: browser game client (Three.js / rendering / UI / input).
- `race-backend/`: authoritative simulation server (physics/game rules/state) + networking.

Do not move logic between front/back without proposal-first.

### Networking Contract
Assume there is an implicit contract between:
- backend authoritative state,
- desktop browser client (viewer),
- mobile controller client (input device).

Therefore:
- Treat socket event names and payload schemas as a stable public API.
- When modifying networking:
  - version changes, feature flags, or dual-protocol support may be required.
  - prefer adding new events rather than changing existing ones.

---

## 2) Style & Conventions (Must Match Existing Code)

### Golden Rule
Before editing any file in a folder, inspect nearby files (same folder/module) and match:
- import ordering style,
- naming,
- class/function structure,
- error handling,
- comments density and tone.

### TypeScript Standards (Baseline)
Apply these ONLY if consistent with existing repo settings; otherwise follow repo settings:
- Prefer `type`/`interface` usage consistent with the local code.
- Avoid `any`. If unavoidable, isolate it and document why.
- Keep functions small and deterministic where possible.
- Do not introduce clever patterns that reduce readability.

### Formatting / Linting
- If the project already uses Prettier/ESLint, you MUST comply.
- Never introduce new formatting tools without proposal-first.
- If lint/format config exists, run it (or at least ensure your changes would pass).

---

## 3) Safe Editing Process (Agent Workflow)

### Step A — Discover
In each subproject you touch:
1) Identify:
   - `package.json` scripts,
   - `tsconfig*.json`,
   - ESLint/Prettier config (`.eslintrc*`, `eslint.config.*`, `.prettierrc*`),
   - build tool (Vite/Webpack/etc),
   - entrypoints and main loops.
2) Summarize what you found in 5–10 bullets (no code dump).

### Step B — Plan
- For small changes: brief plan inline.
- For large changes: proposal-first (mandatory).

### Step C — Implement
- Make changes locally scoped.
- Keep diffs clean and reviewable.

### Step D — Validate
You must validate using the repo’s own scripts (do not invent commands):
- Use `npm run ...` / `pnpm ...` / `yarn ...` as declared in each `package.json`.
- If there are no scripts, propose adding minimal scripts (proposal-first if it affects workflows).

---

## 4) Networking Rules (Socket.IO / Realtime)

When touching networking code:
- Do not rename existing events.
- Do not change existing payload shapes unless backward compatible.
- Prefer schema types for payloads (TypeScript types) so both ends stay consistent.
- Add clear comments where protocol decisions are made (why an event exists, expected frequency, etc.).
- Consider latency/throughput:
  - avoid increasing message frequency without strong reason,
  - avoid sending redundant fields,
  - keep payloads stable and versionable.

If you believe a protocol change is necessary:
- proposal-first,
- include a migration strategy (e.g., support old + new for a period).

---

## 5) Three.js / Client Performance Rules

- Avoid allocations inside the render loop unless already done by the codebase’s style.
- Prefer object reuse/pooling where the local code already uses it.
- Do not “optimize” by changing visuals or gameplay behavior unless requested.
- Any performance change must preserve determinism of gameplay as perceived by the player and server.

---

## 6) Backend Simulation Rules

- Backend is authoritative; do not shift authority to client without proposal-first.
- Preserve tick-rate / fixed-step logic if present.
- Any change that affects physics, collision, or integration step must be explicitly called out as “gameplay-affecting”.

---

## 7) Dependency Policy

- Do not add new dependencies unless absolutely required.
- If you think a new dependency is justified:
  - proposal-first,
  - include alternatives and why they were rejected,
  - keep dependency minimal and well-maintained.

---

## 8) Documentation Expectations

When you change behavior (even small):
- Update or add minimal docs/comments near the change.
- Prefer short, high-signal comments over verbose ones.

---

## 9) Output Expectations for PR/Review

Every deliverable should include:
- What changed (bullets).
- Why (1–3 sentences).
- How to validate (exact commands from repo scripts).
- Compatibility impact:
  - “No protocol changes” OR
  - “Backward compatible change” OR
  - “Requires migration” (proposal-first required before that path).

---

## 10) If Anything Conflicts

If this file conflicts with existing repo constraints/config:
- Existing repo config wins (tsconfig/eslint/prettier/scripts), but
- proposal-first still applies for large changes and dependencies.
