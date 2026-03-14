# Dream Memory Runner (v0 skeleton)

이 디렉터리는 Dream Memory System v0의 **실행 가능한 첫 뼈대**입니다.

현재 포함 범위:
- 전날(KST 기준) 세션 파일 탐색
- `.jsonl` 세션 로그 파싱
- explainable project hint detection (Phase 1)
  - `cwd`에서는 workspace/app root로 보이는 segment와 known project alias를 우선 사용
  - text에서는 known alias, numbered project dir(`05_dream`), 또는 project/repo context가 분명한 slug만 채택
- 기초 importance scoring
- candidate extraction
- promotion / retention 후보 판단
- `tmp/dream-memory/YYYY-MM-DD.report.json` 리포트 출력
- `MEMORY.md` + `memory/` 폴더 bootstrap
- project-aware markdown promotion target resolution
- entry slug marker 기반 merge/replace idempotent write
- **옵션으로 Supabase raw/archive 분석 결과 insert/upsert**
  - `dream_jobs`
  - `dream_sessions`
  - `dream_messages`
  - `dream_memory_candidates`
  - `dream_promotions`
- **옵션으로 markdown promotion write**
  - `--promote=true`
  - snapshot backup 후 section-aware merge/replace
  - 동일 `entry_slug` 재실행 시 duplicate append 대신 replace/no-op
  - project-linked candidate는 `memory/projects/<slug>.md`로, stable preference / operation rule은 `MEMORY.md`로 승격
- **옵션으로 purge dry-run 계획 생성**
  - `--purge=true`
  - 실제 삭제 없이 retention 기반 정리 후보만 계산
- **selective embedding payload preview + explainable recall dry-run**
  - raw session 전체가 아니라 candidate / promoted memory만 대상으로 함
  - `recall.mjs --mode embedding-preview` 로 임베딩 후보 확인
  - `recall.mjs --query ...` 로 project-aware / keyword-aware recall trace 확인
  - `planMemoryRecall()` 결과에 `semantic` / `vectorStub`를 포함해 future vector similarity 연결 지점을 예약
- **옵션으로 embedding document / stub vector persistence**
  - `--embeddings=true` 사용 시 `dream_embedding_documents`, `dream_embeddings` upsert
  - candidate / promotion source key에 직접 연결되고 `payload_fingerprint`를 함께 저장
  - `dream_embeddings.document_id` 로 문서 row와 연결되어 idempotent / replayable queue 역할 수행
  - 기본 provider/model은 `local` / `stub-v1`
  - 실제 외부 embedding API 호출 없이 pending 상태와 audit trail만 저장 가능
  - `--embedding-store=file` 사용 시 Supabase 없이도 `tmp/dream-memory/*.embeddings.json` 로 로컬 persistence 검증 가능
- **semantic retrieval provider stub**
  - 현재는 lexical recall 결과를 seed로 삼는 stub provider만 구현
  - 이후 pgvector / external embedding provider를 같은 인터페이스로 꽂을 수 있음

추가 문서:
- `scripts/dream-memory/ENV_BRIDGE.md` — `03_supabase` env를 dream-memory env로 연결하는 방법
- `supabase/dream_memory_v1_embeddings.sql` — embedding queue/document schema draft

아직 미포함:
- 실제 vector 생성 / 저장
- persisted embedding 기반 semantic search
- purge 실행

## Run

```bash
node scripts/dream-memory/nightly.mjs --date yesterday --dry-run
```

실제 리포트를 파일로 남기려면:

```bash
node scripts/dream-memory/nightly.mjs --date 2026-03-12 --dry-run=false
```

Supabase raw archive까지 같이 넣으려면:

```bash
DREAM_SUPABASE_URL=... \
DREAM_SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/dream-memory/nightly.mjs --date 2026-03-12 --dry-run=false --archive=true
```

markdown promotion까지 실제로 쓰려면:

```bash
node scripts/dream-memory/nightly.mjs --date 2026-03-12 --dry-run=false --promote=true
```

archive + promote + purge plan까지 같이 보려면:

```bash
DREAM_SUPABASE_URL=... \
DREAM_SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/dream-memory/nightly.mjs --date 2026-03-12 --dry-run=false --archive=true --promote=true --purge=true
```

embedding document / stub vector row까지 같이 저장하려면:

```bash
DREAM_SUPABASE_URL=... \
DREAM_SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/dream-memory/nightly.mjs \
  --date 2026-03-12 \
  --dry-run=false \
  --archive=true \
  --embeddings=true \
  --embedding-provider=local \
  --embedding-model=stub-v1
```

Supabase 없이 오늘 밤 MVP 흐름만 로컬에서 검증하려면:

```bash
node scripts/dream-memory/e2e.mjs
```

또는 기존 nightly report를 로컬 embedding snapshot으로 저장하려면:

```bash
node scripts/dream-memory/nightly.mjs \
  --date 2026-03-12 \
  --dry-run=false \
  --embeddings=true \
  --embedding-store=file
```

semantic recall stub을 같이 확인하려면:

```bash
node scripts/dream-memory/recall.mjs \
  --date 2026-03-12 \
  --query "05_dream recall path 뭐였지?" \
  --top-k 5 \
  --semantic-provider stub \
  --semantic-model stub-v1
```

옵션:
- `--date YYYY-MM-DD|yesterday|today`
- `--tz Asia/Seoul`
- `--sessions-dir /path/to/sessions`
- `--memory-root /path/to/workspace`
- `--limit 10`
- `--dry-run true|false`
- `--archive true|false`
- `--promote true|false`
- `--purge true|false`
- `--embeddings true|false`
- `--embedding-provider local|...`
- `--embedding-model stub-v1|...`
- `--embedding-store supabase|file`
- `--embedding-out-file /path/to/output.json`
- `--semantic-provider stub|pgvector|...`
- `--semantic-model stub-v1|...`

Recall / embedding preview:

```bash
node scripts/dream-memory/recall.mjs --date 2026-03-12 --mode embedding-preview
node scripts/dream-memory/recall.mjs --date 2026-03-12 --query "05_dream recall path 뭐였지?" --top-k 5
```

세부 설계 메모는 `docs/selective-embedding-recall-v0_5.md` 참고.

## Notes

- Phase 1 project-awareness currently adds `primaryProjectHint`, `projectHints`, and `projectSignals` into discovered session/report data.
- To reduce report noise, unknown slug-like tokens from text are only kept when they are numbered project dirs, repeated, or appear in explicit `project`/`repo` context.
- `cwd`-based detection is conservative: it prefers workspace/app-root project directories and ignores nested tool/script segments such as `scripts/dream-memory`.
- High-confidence project persistence is available in the writer path.
- Session-project links persist to `dream_session_projects`.
- Candidate-project links now also persist to `dream_candidate_projects`.
- `dream_promotions` row의 `target_file`, `target_section`, `entry_slug`, `promotion_mode`는 실제 markdown writer가 사용하는 경로/전략과 동일하게 계산된다.
- markdown writer는 `<!-- dream-memory:entry ... -->` marker를 사용해 기존 entry를 찾아 replace하며, 동일 내용 재실행은 no-op로 처리한다.
- Archive summary now reports `rowsRequested` and `rowsReturned` with `semantics: "upsert_returned_rows"` so the output matches Supabase upsert behavior more accurately. Legacy `*Inserted` aliases are still included for compatibility.
- `--embeddings=true` 는 core archive table을 건드리지 않고 `dream_embedding_documents` + `dream_embeddings`에 source-key 기반으로 별도 upsert한다.
- embedding document row는 `payload_fingerprint`, `source_ref_json`, `request_count`, `last_requested_at`를 저장해 replayable queue/audit 역할을 한다.
- embedding row는 기본적으로 `local/stub-v1` pending 상태로 저장되며, `document_id`로 연결되어 이후 worker/vector provider가 뒤에서 이어받을 수 있다.
- `planMemoryRecall()` 는 lexical ranking 위에 `semanticProvider.retrieve()` 인터페이스를 끼워 넣을 수 있도록 설계되어 있다.
- The v1 project schema extension (`supabase/dream_memory_v1_projects.sql`) must be applied before `--archive=true` is used for these paths.
- The embedding schema draft (`supabase/dream_memory_v1_embeddings.sql`) must be applied before `--embeddings=true` is used.

## Next

1. actual vector generation worker 추가
2. persisted `dream_embeddings` 기반 semantic search 추가
3. purge 실행기 추가
4. cron 연결 전 운영 규칙 정리
