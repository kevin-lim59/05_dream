# 05_dream

Dream-memory pipeline extracted into a standalone folder/repo candidate.

## Included
- design docs in `docs/`
- runnable nightly pipeline in `scripts/dream-memory/`
- Supabase schema draft in `supabase/dream_memory.sql`
- sample report in `tmp/dream-memory/`
- env example in `dream-memory.env.example`

## Current status
- nightly cron flow validated
- Supabase archive persistence validated
- automation/archive-only filtering tightened
- purge is currently dry-run only
- promotion writing exists, but quality tuning is still in progress

## Run
```bash
node scripts/dream-memory/nightly.mjs --date yesterday --dry-run=false --archive=true --purge=true
```
