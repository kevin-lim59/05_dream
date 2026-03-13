# Project-Aware Memory Implementation Plan

This document turns the project-aware memory model into a concrete implementation plan against the current `05_dream` codebase.

Parent issue:
- #6 Add project-aware memory model and session linking

Related docs:
- `docs/dream-memory-v1-architecture.md`
- `docs/project-aware-memory-model.md`
- `supabase/dream_memory_v1_projects.sql`

---

## Current pipeline insertion points

Based on the current codebase, project-awareness should be introduced in four places:

1. `src/session-discovery.mjs`
2. `src/candidates.mjs`
3. `src/supabase-writer.mjs`
4. `nightly.mjs`

---

## 1) Session discovery changes

Current role:
- reads transcript files
- normalizes session shape
- extracts messages, role counts, sample text, checksum

Recommended additions:
- infer project hints during normalization
- capture lightweight project signals without forcing a final classification

### Suggested new session fields
- `projectHints`
- `projectSignals`
- `primaryProjectHint`

### Example project signals
- cwd path segments
- repo folder names
- explicit project names in system/task text
- known aliases found in user text
- channel/thread naming conventions if available later

### Why here
Discovery is the earliest cheap point where stable non-semantic metadata exists.
This is better than trying to recover project identity later only from candidate text.

---

## 2) Candidate generation changes

Current role:
- converts analyzed sessions into memory candidates
- builds titles, summaries, decisions, and fingerprints

Recommended additions:
- let candidates inherit session-level project context
- optionally let some candidates override session-level inheritance later

### Suggested candidate additions
Inside each candidate object:
- `projectLinks`
- `primaryProject`

### Minimum viable rule
For the first pass:
- if the session has one strong primary project hint, attach it to all candidates
- if the session has multiple weak projects, store links conservatively or skip candidate-level linking

### Why here
Candidates are the first memory-shaped unit. If project context is missing here, later promotion and recall stay too transcript-centric.

---

## 3) Supabase writer changes

Current role:
- upserts jobs
- upserts sessions
- inserts messages
- upserts candidates
- inserts promotions

Recommended additions:
- upsert `dream_projects`
- insert/upsert `dream_session_projects`
- optionally insert/upsert `dream_candidate_projects`

### Recommended write order
1. upsert `dream_jobs`
2. upsert `dream_sessions`
3. upsert `dream_projects`
4. upsert `dream_session_projects`
5. insert `dream_messages`
6. upsert `dream_memory_candidates`
7. optionally upsert `dream_candidate_projects`
8. upsert `dream_promotions`

### Required helper functions
Suggested additions in `src/supabase-writer.mjs`:
- `upsertDreamProjects(...)`
- `buildDreamSessionProjectRows(...)`
- `buildDreamCandidateProjectRows(...)`

### Why this order
Project ids must exist before join rows can be written.
Session ids and candidate ids are also needed for relational joins.

---

## 4) Nightly report changes

Current role:
- orchestrates discovery, scoring, candidate generation, promotion, purge, persistence
- writes a report json

Recommended additions:
- include project-aware output in the nightly report for auditability

### Suggested report additions
At session level:
- `projectHints`
- `primaryProjectHint`
- `projectLinks`

At report count level:
- `projectsDetected`
- `sessionsWithProjectLinks`
- `candidatesWithProjectLinks`

### Why
The dream-memory pipeline is supposed to stay audit-friendly. If project inference happens silently, debugging gets harder.

---

## Proposed implementation phases

## Phase 1 — internal hints only
Goal:
- enrich session objects with project hints
- do not persist yet

Changes:
- `session-discovery.mjs`
- maybe small helper module like `src/project-detection.mjs`
- report output only

Success criteria:
- nightly report visibly shows plausible project hints
- no schema dependency yet

---

## Phase 2 — persist session-project links
Goal:
- persist explicit project and session-project relationships

Changes:
- apply `supabase/dream_memory_v1_projects.sql`
- update `supabase-writer.mjs`
- write only high-confidence session-level links

Success criteria:
- `dream_projects` is populated
- `dream_session_projects` contains stable high-confidence rows
- archive pipeline remains idempotent

---

## Phase 3 — candidate-level project inheritance
Goal:
- carry project context into memory candidates

Changes:
- update `candidates.mjs`
- update writer for `dream_candidate_projects`

Success criteria:
- a candidate can be filtered by project even if the original session covered multiple topics

---

## Phase 4 — project-aware promotions and recall
Goal:
- use project context for markdown targets and future retrieval

Changes:
- project-aware target file planning
- project-aware recall filtering

Success criteria:
- memory outputs become more reusable and less date-fragmented

---

## Recommended helper module

Create:
- `src/project-detection.mjs`

Suggested responsibilities:
- normalize project aliases
- infer projects from cwd/path/text
- rank competing project signals
- return explainable structured hints

Suggested shape:

```js
inferProjectHints({ cwd, messages, sampleUserText, fileName, knownProjects })
=> {
  primaryProjectHint,
  projectHints,
  projectSignals,
}
```

This keeps project logic out of session discovery and writer persistence details.

---

## Minimal first-pass heuristics

Use simple explainable signals first:

1. exact repo/folder name match in `cwd`
2. explicit known project alias in user text
3. explicit known project alias in task/system text
4. fallback to unknown if confidence is weak

Avoid heavy semantic classification in the first pass.

---

## Configuration needs

Future config additions may include:
- known project list
- alias mapping
- cwd path prefixes
- repo URL mapping
- manually pinned project slugs

These can live in env, json, or a checked-in config file later.

---

## Main risk areas

### 1. Over-linking
A weak text mention should not force project assignment.

### 2. Mixed sessions
Some sessions are genuinely multi-project and should remain so.

### 3. Hidden coupling
Project inference should not become tangled with promotion logic too early.

### 4. Persistence before confidence
It is better to store no project link than a misleading strong link.

---

## Recommended next coding tasks

1. add `src/project-detection.mjs`
2. enrich discovery output with project hints
3. expose hints in nightly report
4. validate reports on several real session samples
5. apply project schema extension
6. add persistence for session-project links
7. only after that, add candidate-level links

---

## Practical summary

The first real implementation step for project-aware dream-memory should be:

- detect project hints early,
- keep them explainable,
- surface them in reports,
- persist only high-confidence session-level links first,
- add candidate-level granularity later.

This keeps the v1 upgrade incremental, debuggable, and compatible with the current v0 pipeline.
