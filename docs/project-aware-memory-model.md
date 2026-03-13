# Project-Aware Memory Model

This document describes the first recommended implementation step for dream-memory v1: making sessions and memory candidates explicitly project-aware.

Parent issue:
- #6 Add project-aware memory model and session linking

---

## Why project-awareness comes first

The current v0 pipeline archives sessions and extracts memory candidates, but it still thinks mostly in terms of transcript flow.

That is good enough for:
- nightly archiving,
- candidate extraction,
- conservative promotion gating.

It is not yet good enough for:
- project-scoped recall,
- project-specific long-term memory,
- separating operational chatter from real project memory,
- stable canonical memory per project.

A project-aware model gives the system a durable organizational spine.

---

## Goals

1. Let one session belong to zero, one, or many projects.
2. Let one memory candidate inherit project context from its source session or explicit tagging.
3. Make project filtering available before vector retrieval.
4. Support both daily memory and canonical memory grouped by project.
5. Keep the schema compatible with the current v0 archive tables.

---

## Design principles

### 1) Projects are explicit entities
A project should not only be inferred from text every time. It should exist as a first-class relational object.

### 2) Session-to-project is many-to-many
Some sessions are clearly about one project, but many are mixed:
- multi-project planning
- infra sessions touching several repos
- comparison / migration discussions

So the relationship should allow multiple project links with confidence metadata.

### 3) Candidate-to-project can be inherited or explicit
Most candidates can inherit project context from the parent session.
But some candidates may need more precise project tagging when one session spans multiple projects.

### 4) Project awareness should improve retrieval before embeddings are used
Project filtering is cheap, interpretable, and often more accurate than semantic similarity alone.

---

## Recommended entities

### `dream_projects`
Canonical table for projects known to the memory system.

Suggested fields:
- `id`
- `slug`
- `name`
- `kind` (`app`, `library`, `infra`, `personal`, `research`, `unknown`)
- `repo_url`
- `homepage_url`
- `description`
- `aliases_json`
- `status` (`active`, `paused`, `archived`, `unknown`)
- `created_at`
- `updated_at`

### `dream_session_projects`
Join table connecting archived sessions to projects.

Suggested fields:
- `id`
- `session_id`
- `project_id`
- `link_source` (`explicit`, `inferred`, `manual`, `imported`)
- `confidence_score`
- `primary_project`
- `reason_json`
- `created_at`

### `dream_candidate_projects`
Optional join table connecting candidates directly to projects.

Suggested fields:
- `id`
- `candidate_id`
- `project_id`
- `link_source`
- `confidence_score`
- `reason_json`
- `created_at`

This table is optional in early v1, but recommended if sessions frequently span multiple projects.

---

## Recommended linkage rules

### Session → Project
A session may link to a project when one or more signals exist:
- explicit repo name or folder name
- explicit project slug in system/task prompt
- repeated references to a known project alias
- path prefix strongly associated with a project
- manual override by operator

### Candidate → Project
Use the following precedence:

1. explicit candidate-level project tag
2. inherited primary project from session
3. inherited non-primary project links from session
4. no project link if confidence is too weak

---

## Confidence model

Suggested confidence guidance:

- `0.90 - 1.00` → explicit or operator-confirmed
- `0.70 - 0.89` → strong inference from repo/path/task context
- `0.40 - 0.69` → weak but plausible
- `< 0.40` → do not link automatically

The purpose is not perfect truth. The purpose is to preserve explainable routing and filtering.

---

## Query benefits

Once project links exist, recall can do this before embeddings:

1. detect likely project from current message
2. narrow to relevant sessions/candidates for that project
3. run keyword retrieval inside that subset
4. run vector retrieval only if needed
5. reconstruct the final memory context

This reduces noise and improves trust.

---

## Markdown output impact

Project awareness helps split memory outputs into cleaner destinations.

### Daily memory examples
- `memory/daily/2026-03-13-05_dream.md`
- `memory/daily/2026-03-13-03_voxie.md`
- `memory/daily/2026-03-13-personal.md`

### Canonical memory examples
- `memory/projects/05_dream.md`
- `memory/projects/03_voxie.md`
- `memory/projects/03_supabase.md`

This makes memory less date-fragmented and more reusable.

---

## Migration strategy

### Phase 1 — schema only
- add project tables and indexes
- do not change nightly behavior yet

### Phase 2 — lightweight inference
- infer session project links from known repo/path/task context
- persist only high-confidence project links

### Phase 3 — candidate inheritance
- automatically assign candidate project context
- support project-aware promotion targets

### Phase 4 — recall integration
- use project filtering in runtime retrieval

---

## Anti-goals

- do not require perfect project classification before persistence
- do not block archiving if project is unknown
- do not force every session into exactly one project
- do not rely on vector similarity for project identity

---

## Practical recommendation

If only one piece of v1 is started first, it should be this:

- define `dream_projects`
- define `dream_session_projects`
- optionally define `dream_candidate_projects`
- keep project filtering available before future embedding search

This gives the rest of v1 a much stronger foundation.
