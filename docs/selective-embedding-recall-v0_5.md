# Selective Embedding / Recall v0.5

This document defines the first lightweight implementation for semantic-ready memory in `05_dream`.

## Scope chosen

Conservative by design:

- do **not** embed raw session transcripts wholesale
- do embed only memory-shaped units that already passed extraction
- include promoted markdown entries because they are canonicalized and human-auditable
- keep recall hybrid and explainable before any real vector DB hookup

## Selected embedding targets

### 1. `dream_memory_candidates`
Only when all of the following are true:
- decision is `promote` or `defer`
- kind is one of:
  - `project_state`
  - `user_preference`
  - `operation_rule`
  - `decision`
  - `todo`
  - `relationship`
- summary is non-trivial

### 2. promoted memory entries
- `dream_promotions` / markdown promotion blocks
- these are stronger recall anchors because they are already canonicalized

## Why this scope

It matches the current pipeline naturally:

1. session discovery
2. scoring
3. candidate extraction
4. promotion writing / persistence
5. **selective embedding payload build**
6. **recall planning over candidate + promotion corpus**

This avoids mixing low-signal operational chatter into semantic memory.

## v0.5 / v0.6 transition pieces

### Embedding payload builder
Module: `scripts/dream-memory/src/embedding-payloads.mjs`

Purpose:
- produce embedding-ready payloads without calling any embedding API yet
- keep audit metadata alongside payload text

Output properties include:
- `objectType` (`candidate` | `promotion`)
- `objectId`
- `source`
- `project`
- `text`
- `metadata`
- `audit.selectedBecause`

### Recall planner
Module: `scripts/dream-memory/src/recall-planner.mjs`

Recall order:
1. infer project hints from the current query
2. build recall corpus from candidates + promotions
3. score metadata match first
4. add lexical overlap score
5. rank and return `why` + `audit`

This is intentionally hybrid even before vectors exist.

## Auditability rules

Every recalled item should say:
- what source type it came from (`candidate` vs `promotion`)
- which session it came from
- what project match influenced ranking
- which keywords overlapped
- which target file/section applies for promoted memory

## Local dry-run commands

Generate nightly report first:

```bash
node scripts/dream-memory/nightly.mjs --date 2026-03-13 --dry-run=false
```

Preview what would be embedded:

```bash
node scripts/dream-memory/recall.mjs \
  --date 2026-03-13 \
  --mode embedding-preview
```

Run explainable recall against the report:

```bash
node scripts/dream-memory/recall.mjs \
  --date 2026-03-13 \
  --query "05_dream에서 selective recall path 어떻게 설계했지?" \
  --top-k 5
```

## What is not implemented yet

- actual embedding API calls
- `dream_embeddings` persistence table
- vector similarity search
- recall-event logging back into Supabase
- automatic runtime injection into the main agent context

## Recommended next steps

1. add `dream_embeddings` table and store vectors separately from candidate rows
2. add a small lexical + vector hybrid retriever over persisted candidate/promoted entries
3. log `dream_memory_recall_events` for reuse-based memory strengthening
4. optionally expose a `--source supabase` mode for recall once persistence is ready
