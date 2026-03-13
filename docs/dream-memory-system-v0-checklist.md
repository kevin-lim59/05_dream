# Dream Memory System v0 Implementation Checklist

`dream-memory-system-v0.md` 기준으로 정리한 현실적인 v0 구현 체크리스트다.
목표는 **archive first → analyze second → promote safely → forget carefully → ops visibility 확보** 순서로 바로 작업에 들어갈 수 있게 만드는 것이다.

---

## Phase 1. Archive

### 1.1 Job bootstrap / run control
- [ ] 대상 날짜 계산 로직 구현 (`--date`, `--tz Asia/Seoul`, 기본값=yesterday)
  - 선행조건: nightly runner entrypoint 스펙 합의 (`node` 또는 `pnpm` 커맨드)
  - 위험요소: KST 기준 전날 계산이 서버 로컬 타임존과 어긋나 off-by-one 발생
  - 완료 기준: 임의 날짜 입력과 기본 실행 모두 같은 KST 기준 범위를 산출한다
- [ ] `dream_jobs` 기반 job row 생성 또는 upsert 로직 구현
  - 선행조건: Supabase 연결 정보 확보, SQL 스키마 적용 완료
  - 위험요소: job_date unique 충돌 처리 미흡으로 재실행 불가 또는 중복 row 생성
  - 완료 기준: 같은 `job_date` 재실행 시 기존 job을 재사용하거나 안전하게 상태를 갱신한다
- [ ] 중복 실행 방지 lock 전략 구현 (`job_date` unique + 상태 검사 또는 advisory lock)
  - 선행조건: 배치 실행 순서와 실패 시 재시도 정책 정의
  - 위험요소: 동시에 2개 runner가 떠서 세션/메시지 중복 적재
  - 완료 기준: 동일 날짜에 동시 실행을 시도해도 1개만 실제 처리한다
- [ ] job stage status 전이 구현 (`discovering` → `archiving` → `analyzing` → `promoting` → `forgetting` → `completed/partial/failed`)
  - 선행조건: `dream_jobs.status`, `notes` 사용 규칙 정의
  - 위험요소: 실패 지점이 불명확해 재처리 범위를 판단하기 어려움
  - 완료 기준: 중간 실패 시 어느 단계에서 멈췄는지 DB에서 즉시 확인 가능하다

### 1.2 Session discovery
- [ ] 전날 활동 세션 수집기 구현
  - 선행조건: OpenClaw session log/metadata source 위치 파악
  - 위험요소: 세션 시작일은 전전날인데 마지막 메시지가 전날인 케이스 누락
  - 완료 기준: `last_message_at` 기준으로 전날 활성 세션을 안정적으로 수집한다
- [ ] 세션 메타 정규화 스키마 구현 (`external_session_id`, `channel`, `agent_name`, `started_at`, `ended_at`, `message_count` 등)
  - 선행조건: 원본 로그 포맷 샘플 확보
  - 위험요소: 소스별 필드 불일치로 null/파싱 오류 발생
  - 완료 기준: 서로 다른 세션 타입에서도 공통 필드가 일관되게 채워진다
- [ ] discovery 결과 dedupe 처리 구현
  - 선행조건: 세션 식별자 규칙 확정
  - 위험요소: 같은 세션이 여러 로그 소스에서 중복 발견됨
  - 완료 기준: 동일 `external_session_id`는 1개 후보로만 남는다

### 1.3 Transcript normalization
- [ ] 메시지 순서 보존 가능한 정규화 구현 (`seq_no` 필수)
  - 선행조건: 원본 메시지 배열/타임스탬프 접근 가능
  - 위험요소: tool 결과/시스템 메시지가 섞일 때 순서 뒤틀림
  - 완료 기준: 세션 재구성 시 원문 순서가 손실되지 않는다
- [ ] 메시지 role/author/content/tool metadata 표준화 구현
  - 선행조건: 원본 role 및 tool event 형태 파악
  - 위험요소: tool call과 tool output을 잘못 합쳐 provenance 손실
  - 완료 기준: `dream_messages` row만으로 최소한의 대화 흐름을 추적할 수 있다
- [ ] attachment-only / empty message / long payload 처리 규칙 구현
  - 선행조건: 첨부/긴 tool output 사례 샘플 확보
  - 위험요소: 빈 본문 때문에 insert 실패, 초장문 payload 때문에 DB row 비대화
  - 완료 기준: 긴 payload는 storage pointer로 우회되고, 빈 메시지도 안전하게 적재된다
- [ ] transcript checksum 계산 구현
  - 선행조건: canonical serialization 규칙 정의
  - 위험요소: 매 실행마다 checksum이 달라져 idempotency 깨짐
  - 완료 기준: 동일 transcript 재처리 시 같은 checksum이 생성된다

### 1.4 Raw archive persistence
- [ ] `dream_sessions` upsert 구현
  - 선행조건: SQL 스키마 적용 완료
  - 위험요소: archive 재실행 시 기존 상태를 덮어써 분석/승격 정보 손상
  - 완료 기준: archive 관련 필드만 안전하게 갱신되고 기존 분석 결과는 보존 또는 명시적 재계산된다
- [ ] `dream_messages` bulk insert/upsert 구현
  - 선행조건: `dream_sessions.id` 확보, `(session_id, seq_no)` unique 제약 반영
  - 위험요소: 대량 insert 중 일부 실패 시 세션만 있고 메시지가 없는 반쪽 상태 발생
  - 완료 기준: 트랜잭션 또는 배치 재시도로 세션/메시지 정합성이 유지된다
- [ ] transcript JSONL(.gz 가능) storage 저장 구현
  - 선행조건: Supabase storage bucket 준비 또는 로컬 대체 경로 결정
  - 위험요소: DB에는 archived로 표시됐는데 실제 파일 업로드 실패
  - 완료 기준: 업로드 성공 후에만 `archive_status=archived`, `storage_path`가 기록된다
- [ ] archive 단계 dry-run/verification 스크립트 구현
  - 선행조건: 샘플 세션 2~3개 확보
  - 위험요소: 실데이터로 바로 돌렸다가 스키마/파서 문제를 늦게 발견
  - 완료 기준: 특정 날짜 `--limit N --dry-run`으로 discovery/normalize 결과를 검증할 수 있다

---

## Phase 2. Analyze

### 2.1 Session summarization and scoring
- [ ] 세션 요약 생성 포맷 정의 (`summary_short`, `summary_json`)
  - 선행조건: 분석 출력 JSON schema 초안 합의
  - 위험요소: 요약 포맷이 자주 바뀌어 downstream promotion 로직이 깨짐
  - 완료 기준: 모든 분석 결과가 동일한 키 구조를 따른다
- [ ] importance scoring 함수 구현 (0~100)
  - 선행조건: signal 정의 확정 (`explicit_memory_signal`, `long_term_project_signal`, `decision_made_signal` 등)
  - 위험요소: 점수식이 과민하거나 둔감해서 거의 다 promote/거의 다 archive_only로 쏠림
  - 완료 기준: 샘플 세션 기준 low/medium/high/critical 분포가 상식적으로 나온다
- [ ] importance band 매핑 구현 (`low`, `medium`, `high`, `critical`)
  - 선행조건: score cutoff 확정
  - 위험요소: DB check constraint와 애플리케이션 값 불일치
  - 완료 기준: score 저장 직후 band가 일관되게 계산된다
- [ ] reason codes 생성 구현
  - 선행조건: 대표 reason code 목록 정의
  - 위험요소: 사람이 나중에 decision 이유를 이해할 수 없게 됨
  - 완료 기준: 각 중요 candidate에 최소 1개 이상 근거 코드가 남는다

### 2.2 Memory candidate extraction
- [ ] candidate schema 구현 (`kind`, `title`, `summary`, `detail_json`, `confidence_score`, `decision` 등)
  - 선행조건: `dream_memory_candidates` 테이블 생성 완료
  - 위험요소: summary만 있고 source provenance가 없어 승격 신뢰도 하락
  - 완료 기준: 후보마다 출처 메시지와 근거 점수가 함께 저장된다
- [ ] `kind` 분류 규칙 구현 (`project_state`, `user_preference`, `decision`, `operation_rule`, `fact`, `todo` 등)
  - 선행조건: 분류 사전 정의
  - 위험요소: 사실상 모두 `fact`로 들어가 파일 라우팅 불가능
  - 완료 기준: 승격 가능한 후보가 적절한 도메인 kind로 분류된다
- [ ] source message id 수집 구현
  - 선행조건: raw message 식별자/seq_no 접근 가능
  - 위험요소: 후보 문장이 어디서 왔는지 추적 불가
  - 완료 기준: candidate마다 `source_message_ids`가 남고 원문 검증이 가능하다
- [ ] candidate decision 1차 규칙 구현 (`promote`, `defer`, `archive_only`, `reject`)
  - 선행조건: importance cutoff와 explicit rule 정의
  - 위험요소: speculative 내용이 자동 promote 되어 memory 오염
  - 완료 기준: 장기 규칙/선호/결정은 promote, 단발성 잡담은 reject 또는 archive_only로 떨어진다

### 2.3 Analysis persistence
- [ ] `dream_sessions.analysis_status`, `importance_score`, `importance_band`, `summary_*` 갱신 구현
  - 선행조건: 분석 함수 출력 안정화
  - 위험요소: 분석 실패 시 세션 상태가 애매하게 남음
  - 완료 기준: 성공/실패/재시도 여부가 DB에서 분명히 보인다
- [ ] `dream_memory_candidates` bulk insert/upsert 구현
  - 선행조건: 후보 dedupe 키 전략 결정(세션+title, 또는 detail hash 등)
  - 위험요소: 같은 세션 재분석 때 후보가 누적 중복됨
  - 완료 기준: 동일 세션 재분석 시 후보 중복이 폭증하지 않는다
- [ ] 분석 실패 세션 재처리 경로 구현
  - 선행조건: `failed` 세션 조회 가능
  - 위험요소: archive는 됐는데 analyze 실패한 세션이 영구 방치됨
  - 완료 기준: `--replay-failed` 또는 특정 session 재실행이 가능하다

---

## Phase 3. Promote

### 3.1 Memory file layout bootstrap
- [ ] `MEMORY.md`와 `memory/` 기본 디렉터리 구조 초기화
  - 선행조건: memory 파일 구조 합의
  - 위험요소: 첫 승격 때 파일 경로가 제각각 생성되어 정리 불가
  - 완료 기준: 최소 `MEMORY.md`, `memory/README.md`, `memory/inbox.md`, 도메인 폴더가 준비된다
- [ ] 도메인별 파일 라우팅 규칙 구현
  - 선행조건: `kind -> target_file/section` 매핑표 정의
  - 위험요소: 같은 종류 정보가 파일 여러 곳에 흩어짐
  - 완료 기준: 동일 kind는 일관된 파일/섹션으로 들어간다
- [ ] memory file template 작성
  - 선행조건: 필수 메타데이터 항목 정의 (`Last updated`, `Confidence`, `Sources`)
  - 위험요소: 승격 포맷이 매번 달라 merge 자동화 어려움
  - 완료 기준: 새 항목 생성 시 고정된 markdown 블록 구조를 사용한다

### 3.2 Safe write / backup
- [ ] memory 파일 수정 전 snapshot 또는 backup 생성 구현
  - 선행조건: 백업 위치 규칙 확정 (`memory/.snapshots/` 또는 `.bak`)
  - 위험요소: 잘못된 promotion이 파일을 망가뜨렸을 때 복구 불가
  - 완료 기준: promotion 직전 원본 복사본이 남고 롤백이 가능하다
- [ ] targeted replace / append writer 구현
  - 선행조건: 섹션 anchor 규칙 확정
  - 위험요소: 파일 전체 재작성으로 사람이 수동 정리한 내용 손실
  - 완료 기준: 지정 섹션에만 append/merge/replace가 적용된다
- [ ] secret-like / transcript-dump 차단 검증 구현
  - 선행조건: 간단한 패턴 차단 규칙 정의
  - 위험요소: 민감정보 또는 원문 대량 복붙이 장기 memory에 승격됨
  - 완료 기준: 금지 패턴 감지 시 promote 대신 inbox/defer 처리된다

### 3.3 Dedupe and merge
- [ ] `entry_slug` 생성 규칙 구현
  - 선행조건: `kind`, entity, topic 기반 slug 설계
  - 위험요소: 같은 사실이 여러 slug로 갈라져 중복 memory 생성
  - 완료 기준: 대표적인 장기 규칙/프로젝트 상태가 안정적으로 같은 slug를 재사용한다
- [ ] 기존 항목 비교 후 append/merge/replace 판단 구현
  - 선행조건: target file 내 기존 항목 파싱 가능해야 함
  - 위험요소: 사소한 문장 차이로 중복 항목 계속 생성
  - 완료 기준: 동일/유사 항목은 source만 추가하거나 기존 블록을 갱신한다
- [ ] 충돌 정보는 `memory/inbox.md` 또는 defer로 우회하는 로직 구현
  - 선행조건: 충돌 판정 기준 정의
  - 위험요소: 상충되는 정책을 자동으로 덮어써 잘못된 stable memory 형성
  - 완료 기준: 충돌 케이스는 자동 promote하지 않고 review 대상으로 남긴다

### 3.4 Promotion persistence
- [ ] `dream_promotions` insert/upsert 구현
  - 선행조건: `dream_memory_candidates.id`, `target_file`, `entry_slug` 확보
  - 위험요소: 파일은 수정됐는데 DB 기록이 없어 provenance 추적 불가
  - 완료 기준: 모든 실제 file write에 대응하는 promotion row가 남는다
- [ ] `dream_sessions.promotion_status` 및 promoted session count 갱신 구현
  - 선행조건: candidate decision과 promotion 성공 여부 집계 가능
  - 위험요소: 일부 candidate만 승격됐는데 세션 상태가 잘못 표시됨
  - 완료 기준: 세션 단위 상태와 job 집계가 실제 promotion 결과와 일치한다
- [ ] promote 단계 replay 안전성 검증
  - 선행조건: unique key/slug 전략 구현 완료
  - 위험요소: 같은 날짜 재실행 시 memory 중복 append
  - 완료 기준: 동일 job 재실행 후 파일 diff가 불필요하게 늘어나지 않는다

---

## Phase 4. Forget

### 4.1 Retention classification
- [ ] retention class 계산 로직 구현 (`promoted`, `standard`, `ephemeral`, `sensitive_hold`)
  - 선행조건: importance/promotion/sensitivity 정보 확보
  - 위험요소: 민감 가능 세션이 너무 짧은 retention으로 설정됨
  - 완료 기준: 승격/민감도/가치에 따라 class가 합리적으로 분기된다
- [ ] `purge_after` 계산 구현 (환경변수 기반 일수)
  - 선행조건: retention days 정책 확정
  - 위험요소: 잘못된 기본값으로 archive가 지나치게 빨리 삭제됨
  - 완료 기준: 각 세션에 class별 예상 만료 시각이 기록된다
- [ ] 저가치 세션 summary 최소 보존 규칙 정리
  - 선행조건: purge 후 남길 최소 메타데이터 정의
  - 위험요소: purge 후 왜 버렸는지 설명할 근거가 사라짐
  - 완료 기준: purge 이후에도 audit 가능한 최소 row가 유지된다

### 4.2 Purge flow (initially safe)
- [ ] purge 대상 조회 쿼리/마커 구현
  - 선행조건: `purge_after` 및 archive_status 값 존재
  - 위험요소: 아직 승격 검증 안 끝난 세션까지 purge 대상으로 잡힘
  - 완료 기준: 만료 + 비보호 상태 세션만 후보로 표시된다
- [ ] purge dry-run 리포트 구현
  - 선행조건: purge 로직 초안 구현
  - 위험요소: 실제 삭제 전 영향 범위 검토가 어려움
  - 완료 기준: 어떤 세션/메시지가 삭제될지 dry-run 결과로 확인 가능하다
- [ ] 실제 삭제는 단계적으로 구현 (`storage raw` → `dream_messages` → optional metadata compaction)
  - 선행조건: dry-run 검증 통과, 복구 경로 확인
  - 위험요소: 삭제 순서 오류로 provenance/감사 정보까지 손실
  - 완료 기준: raw와 message는 정리되더라도 최소 세션 메타와 promotion 기록은 남는다
- [ ] purge 결과 상태 기록 (`purged_at`, notes/result_json 또는 status 갱신)
  - 선행조건: 결과 기록 컬럼 또는 메모 구조 준비
  - 위험요소: 삭제가 실제 수행됐는지 나중에 확인 불가
  - 완료 기준: 어떤 세션이 언제 purge 되었는지 조회 가능하다

---

## Phase 5. Ops

### 5.1 Runtime / config / environment
- [ ] 환경변수 정리 (`DREAM_MEMORY_TZ`, Supabase URL/KEY, bucket, retention days, memory root)
  - 선행조건: 실행 환경(.env 또는 secret store) 확정
  - 위험요소: 운영/개발 환경이 다른 값을 써서 날짜/보존 정책 불일치
  - 완료 기준: 로컬/운영에서 같은 설정 키를 사용하고 문서화되어 있다
- [ ] CLI 옵션 정리 (`--date`, `--dry-run`, `--limit`, `--replay-failed`, `--skip-purge`)
  - 선행조건: runner 엔트리포인트 구현
  - 위험요소: 운영자가 실패 복구나 부분 실행을 못 함
  - 완료 기준: 주요 운영 시나리오를 CLI 옵션만으로 처리 가능하다
- [ ] stage별 structured logging 구현
  - 선행조건: 로거 선택 또는 기본 JSON 로그 포맷 정의
  - 위험요소: 실패 세션 id나 단계 정보가 로그에 남지 않음
  - 완료 기준: job/date/session 기준으로 로그 검색이 가능하다

### 5.2 Observability and failure handling
- [ ] job 결과 집계 및 `dream_jobs.notes` 기록 구현
  - 선행조건: 단계별 count 산출 가능
  - 위험요소: partial failure 원인을 DB만 보고 이해하기 어려움
  - 완료 기준: discovered / archived / promoted / failed / purge-marked 통계가 남는다
- [ ] partial failure 처리 구현
  - 선행조건: 세션 단위 오류 격리 가능
  - 위험요소: 1개 세션 실패 때문에 전체 job가 전부 롤백되거나 반대로 실패가 묻힘
  - 완료 기준: 일부 실패 시 `partial` 상태와 실패 세션 목록이 기록된다
- [ ] archive-only / analyze-only / promote-only 재실행 경로 설계
  - 선행조건: 단계별 상태값 분리
  - 위험요소: recovery 때 전체 job를 다시 돌려 부작용 발생
  - 완료 기준: 특정 단계만 제한적으로 재실행할 수 있다
- [ ] 간단한 운영 알림 또는 요약 출력 구현
  - 선행조건: 로그/메시지 전달 경로 선택(콘솔 또는 운영 채널)
  - 위험요소: nightly 실패가 며칠간 unnoticed 상태로 누적
  - 완료 기준: 실패/partial 시 최소 요약이 남는다

### 5.3 Validation before go-live
- [ ] 샘플 날짜 1일치로 end-to-end dry-run 수행
  - 선행조건: archive/analyze/promote/forget 기본 로직 연결 완료
  - 위험요소: 각 단계는 되지만 전체 플로우에서 필드 연결이 깨짐
  - 완료 기준: dry-run 결과로 세션 수집, candidate 생성, promotion preview가 모두 확인된다
- [ ] 샘플 날짜 1일치로 실제 write 모드 검증
  - 선행조건: dry-run 검토 완료, backup 활성화
  - 위험요소: 첫 실제 실행에서 memory 파일 중복/형식 깨짐
  - 완료 기준: SQL row, storage path, memory 파일, promotion record가 서로 일치한다
- [ ] 동일 날짜 재실행(idempotency) 테스트
  - 선행조건: 최소 1회 write 성공 사례 존재
  - 위험요소: nightly 재시도 시 중복 세션/중복 memory/중복 promotion 생성
  - 완료 기준: 재실행 후 데이터와 파일 상태가 안정적으로 유지된다
- [ ] cron 등록 전 수동 운영 가이드 작성
  - 선행조건: 명령어/옵션/로그 위치 확정
  - 위험요소: 장애 시 운영자가 즉시 재실행/점검 방법을 모름
  - 완료 기준: 실행, 실패 확인, 재처리, purge dry-run 방법이 짧게 문서화되어 있다

---

## Suggested delivery order

아래 순서로 구현하면 v0 리스크를 가장 낮출 수 있다.

1. [ ] SQL 스키마 적용
2. [ ] discovery + archive end-to-end
3. [ ] summarize + scoring + candidate 저장
4. [ ] memory 폴더 초기화 + safe promotion
5. [ ] retention 계산
6. [ ] purge dry-run
7. [ ] 재실행/partial failure/ops polish
8. [ ] cron 연결

---

## Exit criteria for v0

다음 조건을 만족하면 Dream Memory System v0의 첫 운영이 가능하다고 본다.

- [ ] 전날 세션을 KST 기준으로 안정적으로 수집한다
- [ ] raw transcript와 세션/메시지 메타데이터가 Supabase에 적재된다
- [ ] 각 세션에 importance score와 candidate memory가 생성된다
- [ ] 중요한 항목만 `MEMORY.md` / `memory/*.md`로 안전하게 승격된다
- [ ] 승격 provenance가 `dream_promotions`에 남는다
- [ ] 낮은 가치 세션에 retention/purge 일정이 부여된다
- [ ] 같은 날짜 재실행 시 중복 적재/중복 승격이 발생하지 않는다
- [ ] 실패와 partial 상태를 운영자가 DB/로그로 확인하고 재처리할 수 있다
