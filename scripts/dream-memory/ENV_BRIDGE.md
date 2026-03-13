# Dream Memory Supabase Env Bridge

`persistArchiveReport()` expects these env vars:

- `DREAM_SUPABASE_URL`
- `DREAM_SUPABASE_SERVICE_ROLE_KEY`

## Mapping from `03_supabase`

For the self-hosted Supabase project in `03_supabase`, the natural mapping is:

- `DREAM_SUPABASE_SERVICE_ROLE_KEY` <- `SERVICE_ROLE_KEY`
- `DREAM_SUPABASE_URL` <- `API_EXTERNAL_URL`

Important:
- The dream-memory writer appends `/rest/v1` itself.
- So `DREAM_SUPABASE_URL` should be the base API URL only.
- Example shape: `http://localhost:8000` or `https://supabase.example.com`
- Do **not** include `/rest/v1` in `DREAM_SUPABASE_URL`.

## Example shell wrapper

```bash
export DREAM_SUPABASE_URL="$API_EXTERNAL_URL"
export DREAM_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
node scripts/dream-memory/nightly.mjs --date yesterday --dry-run=false --archive=true --purge=true
```

## Validation checklist

1. `03_supabase/dev/dream_memory.sql` has been applied.
2. `API_EXTERNAL_URL` resolves to the PostgREST gateway.
3. `SERVICE_ROLE_KEY` is valid for the self-hosted stack.
4. A POST to `${DREAM_SUPABASE_URL}/rest/v1/dream_jobs` with service-role auth succeeds.
