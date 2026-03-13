# Dream Memory System v0

OpenClaw가 하루의 대화를 "꿈"처럼 한 번 다시 훑고, 모든 세션을 raw archive로 보존한 뒤, 장기적으로 가치 있는 것만 구조화된 memory로 승격하며, 나머지는 안전하게 잊어버리도록 만드는 v0 설계 초안이다. 이름은 낭만적이지만, 구현은 운영 가능한 데이터 파이프라인을 기준으로 설계한다.

---

## 1. 목표와 비목표

### 목표

1. **어제의 모든 세션 대화를 매일 새벽 2시경 수집**한다.
2. 수집한 원문을 **Supabase에 raw archive로 저장**한다.
3. 세션별로 중요도를 평가해, 가치 있는 내용만 **`MEMORY.md` / `memory/*.md`** 로 승격한다.
4. 중요하지 않은 세션은 일정 기간 이후 정리하되, **감사 가능성(auditability)** 과 **복구 가능성(recoverability)** 을 유지한다.
5. v0에서는 복잡한 자율 추론보다, **명시적 규칙 + 사람이 읽을 수 있는 산출물** 중심으로 설계한다.
6. 같은 세션을 여러 번 처리해도 결과가 크게 꼬이지 않도록 **idempotent** 하게 설계한다.

### 비목표

1. v0에서 **완전 자동 지식 그래프 구축**은 하지 않는다.
2. v0에서 **실시간 메모리 반영**은 하지 않는다. 배치 중심이다.
3. v0에서 **모든 대화를 요약해서 파일화**하지 않는다. 중요한 것만 승격한다.
4. v0에서 **완벽한 의미 이해 기반 importance 판단**을 목표로 하지 않는다. 우선은 운영 가능한 휴리스틱/스코어 기반으로 시작한다.
5. v0에서 **사용자별 고급 privacy policy 엔진**이나 **세밀한 redaction workflow**까지는 포함하지 않는다. 다만 확장 가능한 필드는 넣는다.

---

## 2. 전체 아키텍처

Dream Memory System v0는 3계층으로 나눈다.

### A. Raw Archive Layer

역할:
- 전날의 세션 대화 원문을 가능한 한 손실 없이 저장
- 향후 재처리(reprocessing), 감사(audit), 승격 규칙 개선의 기반 제공

저장 위치:
- **Supabase Postgres**: 메타데이터, 인덱싱 가능한 본문/청크/요약
- 필요 시 **Supabase Storage**: 매우 긴 transcript, 압축 JSONL, 첨부 메타데이터

핵심 원칙:
- raw는 가공 최소화
- 삭제 전까지 원문 복원 가능
- 세션 단위와 메시지 단위를 모두 추적 가능

### B. Consolidated Memory Layer

역할:
- 장기적으로 기억해야 하는 내용만 정제
- 사람이 읽기 쉬운 Markdown 중심 관리
- OpenClaw의 "작업 기억"이 아니라 "축적된 장기 기억" 역할

저장 위치:
- `/Users/bini/.openclaw/workspace/MEMORY.md`
- `/Users/bini/.openclaw/workspace/memory/*.md`

핵심 원칙:
- raw 전체를 복제하지 않음
- 사실, 선호, 장기 프로젝트, 운영 정책, recurring context 위주 저장
- 출처(session/message/promotion id)를 남겨 추적 가능하게 함

### C. Forgetting Layer

역할:
- 중요하지 않은 세션/중간 산출물/중복 요약을 정리
- 저장 비용, 컨텍스트 오염, 개인정보 축적 리스크를 줄임

핵심 원칙:
- 즉시 삭제보다 **보존 기간 + soft delete + purge** 순서 선호
- 승격된 기억은 남기되, 원본 raw는 정책에 따라 만료 가능
- 실패 시 복구 가능한 지점을 남김

### 상위 구조 다이어그램

```text
[OpenClaw session logs]
        ↓
[Nightly Dream Job @ ~02:00]
        ↓
(1) Collect yesterday sessions
        ↓
(2) Archive raw transcript to Supabase
        ↓
(3) Score importance / detect candidate memories
        ↓
 ┌───────────────┴───────────────┐
 ↓                               ↓
Promote important items          Mark low-value sessions
 ↓                               ↓
Update MEMORY.md + memory/*.md   Retain briefly → prune/purge by policy
 ↓
Record promotion metadata + provenance
```

---

## 3. 데이터 흐름 (nightly 2am dream job)

기준 시간대는 **Asia/Seoul** 로 고정한다.

### 실행 시점
- 매일 **02:00 KST** 전후 실행
- 처리 대상: **전날 00:00:00 ~ 23:59:59 KST 사이에 활동이 있었던 세션**

### 단계별 흐름

#### Step 0. Job lock 획득
- 중복 실행 방지를 위해 advisory lock 또는 `dream_jobs` 상태 테이블 사용
- lock key 예시: `dream-job:2026-03-12`

#### Step 1. 대상 세션 식별
입력 소스 예시:
- OpenClaw session log directory
- OpenClaw session metadata store
- channel transcript export

필터:
- `started_at` 또는 `last_message_at` 기준 전날에 걸친 세션
- 이미 `archive_status = archived` 인 세션은 스킵 또는 checksum 비교 후 재처리

산출물:
- `session_candidates[]`

예시:
```json
{
  "session_id": "agent:miku:discord:channel:1481895983720828998",
  "channel": "discord",
  "started_at": "2026-03-12T09:14:02+09:00",
  "ended_at": "2026-03-12T10:03:51+09:00",
  "message_count": 84
}
```

#### Step 2. Raw transcript 수집 및 정규화
수집 대상:
- 사용자 메시지
- 에이전트 응답
- system/developer context 일부 메타데이터
- tool call 결과에 대한 핵심 메타데이터

정규화 포맷 예시:
```json
{
  "message_id": "msg_000184",
  "session_id": "agent:miku:discord:channel:1481895983720828998",
  "role": "user",
  "author": "bini",
  "created_at": "2026-03-12T09:20:11+09:00",
  "content_text": "내일 배포 전에 이 PR 한번 더 봐줘",
  "tool_name": null,
  "attachments": [],
  "tokens_estimate": 18,
  "sensitivity": "unknown"
}
```

정규화 시 고려:
- message order 보존 (`seq_no` 필수)
- 빈 메시지, attachment-only 메시지 처리
- tool output 전문은 길면 별도 storage object에 저장하고 DB에는 pointer만 저장

#### Step 3. Supabase raw archive 적재
- 세션 메타데이터 upsert
- 메시지 단위 bulk insert/upsert
- transcript checksum 기록
- storage object path 기록

예시 path:
- `dream-archive/2026/03/12/<session_id>.jsonl.gz`

#### Step 4. 세션 분석 및 importance scoring
각 세션에 대해 아래를 계산:
- 세션 요약
- 핵심 엔티티/프로젝트/결정사항 추출
- 중요도 점수
- memory candidate 목록
- pruning recommendation

중간 산출물 예시:
```json
{
  "session_id": "agent:miku:discord:channel:1481895983720828998",
  "importance_score": 78,
  "importance_band": "high",
  "candidate_memories": [
    {
      "kind": "project_state",
      "title": "03_voxie deck-first 전략 유지",
      "summary": "향후 구현 우선순위는 user layer → deck detail → YouTube embed 순으로 유지한다.",
      "confidence": 0.89,
      "source_message_ids": ["msg_000184", "msg_000190"]
    }
  ]
}
```

#### Step 5. 승격 결정
규칙 기반으로 candidate를 분류:
- `promote`
- `review_later`
- `archive_only`
- `discard_after_retention`

승격 대상은 아래 두 갈래로 반영:
1. `MEMORY.md`의 상위 인덱스/핵심 사실 업데이트
2. `memory/*.md`의 주제별 파일 생성/append/merge

#### Step 6. 파일 반영
예시:
- `MEMORY.md`: 전역 요약, active priorities, stable preferences
- `memory/projects/03_voxie.md`: 프로젝트별 장기 맥락
- `memory/preferences/communication.md`: 사용자 선호
- `memory/operations/openclaw.md`: 운영 정책

파일 반영 방식:
- 가능하면 **append-only + structured sections**
- 완전 재작성보다 **targeted replace** 선호
- 각 항목에 `Last promoted`, `Sources`, `Confidence` 남김

#### Step 7. Forgetting/purge 표시
중요도 낮고 승격 없는 세션은:
- `retention_class = low_value`
- `purge_after = archived_at + 30 days` 같은 정책 적용

#### Step 8. Job 결과 기록
기록 항목:
- 총 세션 수
- archive 성공/실패 수
- 승격된 memory 수
- purge 예약 수
- 오류 로그

---

## 4. Supabase schema 초안 (테이블/컬럼)

v0에서는 테이블 수를 과하게 늘리지 않고, 운영/디버깅에 필요한 최소 구조로 시작한다.

### 4.1 `dream_jobs`

배치 실행 기록.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `uuid` PK | job id |
| `job_date` | `date` unique | 처리 대상 날짜 (KST 기준 전날) |
| `status` | `text` | `running`, `completed`, `failed`, `partial` |
| `started_at` | `timestamptz` | 시작 시각 |
| `finished_at` | `timestamptz` | 종료 시각 |
| `lock_key` | `text` | 중복 실행 방지용 키 |
| `sessions_discovered` | `int` | 발견 세션 수 |
| `sessions_archived` | `int` | raw 적재 성공 수 |
| `sessions_promoted` | `int` | memory 승격 발생 세션 수 |
| `sessions_failed` | `int` | 실패 수 |
| `notes` | `jsonb` | 에러/통계/버전 정보 |
| `created_at` | `timestamptz` default now() | 생성 시각 |

### 4.2 `dream_sessions`

세션 메타데이터와 처리 상태.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `uuid` PK | 내부 id |
| `external_session_id` | `text` unique | OpenClaw session id |
| `job_id` | `uuid` FK `dream_jobs.id` | 처리한 job |
| `channel` | `text` | `discord`, `cli`, `telegram` 등 |
| `agent_name` | `text` | `miku`, `meiko` 등 |
| `user_id` | `text` nullable | 사용자 식별자 |
| `started_at` | `timestamptz` | 세션 시작 |
| `ended_at` | `timestamptz` | 세션 종료 |
| `last_message_at` | `timestamptz` | 마지막 메시지 시각 |
| `message_count` | `int` | 메시지 수 |
| `tool_call_count` | `int` | tool 호출 수 |
| `char_count` | `int` | 본문 문자 수 |
| `transcript_checksum` | `text` | 원문 checksum |
| `archive_status` | `text` | `pending`, `archived`, `failed` |
| `analysis_status` | `text` | `pending`, `analyzed`, `failed` |
| `promotion_status` | `text` | `none`, `promoted`, `review_later` |
| `importance_score` | `numeric(5,2)` | 0~100 점수 |
| `importance_band` | `text` | `low`, `medium`, `high`, `critical` |
| `retention_class` | `text` | `ephemeral`, `standard`, `promoted`, `sensitive_hold` |
| `purge_after` | `timestamptz` nullable | 삭제 예정 시각 |
| `storage_path` | `text` nullable | raw transcript path |
| `summary_short` | `text` nullable | 한두 줄 요약 |
| `summary_json` | `jsonb` nullable | 구조화 요약 |
| `created_at` | `timestamptz` default now() | 생성 시각 |
| `updated_at` | `timestamptz` default now() | 갱신 시각 |

권장 인덱스:
- `unique(external_session_id)`
- `index(job_id)`
- `index(last_message_at)`
- `index(importance_band, retention_class)`

### 4.3 `dream_messages`

메시지 단위 raw archive.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `uuid` PK | 내부 id |
| `session_id` | `uuid` FK `dream_sessions.id` | 소속 세션 |
| `external_message_id` | `text` nullable | 원본 message id |
| `seq_no` | `int` | 세션 내 순서 |
| `role` | `text` | `system`, `developer`, `user`, `assistant`, `tool` |
| `author_name` | `text` nullable | 표시 이름 |
| `created_at` | `timestamptz` | 메시지 시각 |
| `content_text` | `text` | 본문 텍스트 |
| `content_json` | `jsonb` nullable | rich payload |
| `tool_name` | `text` nullable | tool 호출 시 도구명 |
| `tool_call_id` | `text` nullable | 추적용 |
| `attachment_count` | `int` default 0 | 첨부 수 |
| `attachment_json` | `jsonb` nullable | 첨부 메타 |
| `tokens_estimate` | `int` nullable | 추정 토큰 |
| `sensitivity` | `text` default 'unknown' | `unknown`, `low`, `pii_possible`, `secret_possible` |
| `storage_overflow_path` | `text` nullable | 긴 payload 별도 저장 위치 |
| `created_row_at` | `timestamptz` default now() | 적재 시각 |

권장 제약:
- `unique(session_id, seq_no)`

### 4.4 `dream_memory_candidates`

세션 분석 결과로 나온 memory 후보.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `uuid` PK | candidate id |
| `session_id` | `uuid` FK `dream_sessions.id` | 출처 세션 |
| `kind` | `text` | `project_state`, `user_preference`, `decision`, `todo`, `fact`, `relationship` |
| `title` | `text` | candidate 제목 |
| `summary` | `text` | 승격 후보 내용 |
| `detail_json` | `jsonb` | 구조화 필드 |
| `confidence_score` | `numeric(5,2)` | 0~1 또는 0~100 중 하나로 통일 |
| `importance_score` | `numeric(5,2)` | 항목 중요도 |
| `novelty_score` | `numeric(5,2)` | 기존 memory 대비 새로움 |
| `actionability_score` | `numeric(5,2)` | 이후 행동에 도움이 되는 정도 |
| `decision` | `text` | `promote`, `defer`, `archive_only`, `reject` |
| `reason_codes` | `text[]` | 예: `{explicit_preference, long_term_project}` |
| `source_message_ids` | `text[]` | 출처 메시지들 |
| `created_at` | `timestamptz` default now() | 생성 시각 |

### 4.5 `dream_promotions`

실제로 memory 파일로 승격된 기록.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `uuid` PK | promotion id |
| `candidate_id` | `uuid` FK `dream_memory_candidates.id` | 원본 candidate |
| `session_id` | `uuid` FK `dream_sessions.id` | 출처 세션 |
| `target_file` | `text` | 예: `memory/projects/03_voxie.md` |
| `target_section` | `text` | 예: `## Active Priorities` |
| `entry_slug` | `text` | dedupe용 key |
| `promotion_mode` | `text` | `append`, `merge`, `replace` |
| `content_markdown` | `text` | 실제 기록된 markdown |
| `source_refs_json` | `jsonb` | session/message/promoted_at 등 |
| `created_at` | `timestamptz` default now() | 생성 시각 |

### 4.6 선택 테이블: `dream_forgetting_queue`

v0에서 테이블을 줄이고 싶다면 `dream_sessions.retention_class/purge_after` 만으로도 충분하다. 다만 운영 가시성을 위해 별도 큐를 둘 수도 있다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | `uuid` PK | queue id |
| `session_id` | `uuid` FK `dream_sessions.id` | 대상 세션 |
| `action` | `text` | `purge_raw`, `purge_messages`, `compact_summary` |
| `scheduled_for` | `timestamptz` | 실행 예정 시각 |
| `status` | `text` | `queued`, `done`, `failed`, `canceled` |
| `result_json` | `jsonb` nullable | 실행 결과 |
| `created_at` | `timestamptz` default now() | 생성 시각 |

---

## 5. Memory 파일 구조 제안

v0의 핵심은 **DB가 진실의 원천(raw/archive/metadata)** 이고, **Markdown memory는 운영용 장기 기억 인터페이스** 라는 점이다.

### 루트 구조

```text
/Users/bini/.openclaw/workspace/
├── MEMORY.md
└── memory/
    ├── README.md
    ├── inbox.md
    ├── projects/
    │   ├── 03_voxie.md
    │   └── openclaw.md
    ├── preferences/
    │   ├── communication.md
    │   └── workflow.md
    ├── people/
    │   └── bini.md
    ├── operations/
    │   ├── deployment.md
    │   └── infra.md
    └── decisions/
        └── 2026-03.md
```

### `MEMORY.md` 역할

전역 인덱스 + 가장 안정적인 핵심 기억만 담는다.

권장 섹션:
- `## Identity / Core Context`
- `## Active Projects`
- `## Stable Preferences`
- `## Current Priorities`
- `## Operational Rules`
- `## Recent Promoted Memories`

예시:
```md
## Active Projects
- `03_voxie`: curated fandom archive. deck-first / curator-first 전략 유지.
  - Last promoted: 2026-03-12
  - Source: session agent:miku:discord:channel:1481895983720828998
```

### `memory/README.md`

폴더 규칙 문서.
- 어떤 정보가 어디로 가는지 정의
- 중복 기록 금지 원칙
- 승격/병합 규칙 명시

### `memory/inbox.md`

애매하지만 버리기 아까운 내용을 임시 적재하는 저신뢰 구역.
- v0에서 사람이 확인하기 좋은 완충 지대
- 추후 승격 또는 폐기

### 파일별 작성 원칙

1. **한 파일 = 한 도메인**
2. 각 항목은 되도록 다음 메타데이터 포함
   - `Last updated`
   - `Confidence`
   - `Sources`
3. 바뀌는 사실은 append 로그가 아니라 **현재 상태 + 필요 최소한의 이력** 중심
4. 중복 항목 생성보다 기존 항목 merge 우선

### 예시 템플릿: `memory/projects/03_voxie.md`

```md
# 03_voxie

## Snapshot
- Product direction: curated fandom archive
- Primary unit: deck (not just card)
- Growth path: card archive → deck culture → curator identity → curator community

## Active Priorities
1. user profile / attribution
2. deck detail 강화
3. YouTube embed

## Important Decisions
- Deck-first UX를 우선한다.
  - Last updated: 2026-03-12
  - Confidence: high
  - Sources:
    - session: agent:miku:discord:channel:1481895983720828998
    - promotion: prm_...
```

---

## 6. 중요도 점수화 / 승격 규칙

v0에서는 LLM 판단만 믿지 않고, **휴리스틱 + 구조화된 이유 코드(reason codes)** 를 함께 저장한다.

### 6.1 세션 중요도 점수 (0~100)

권장 계산식 예시:

```text
importance_score =
  explicit_memory_signal * 25 +
  long_term_project_signal * 20 +
  decision_made_signal * 15 +
  user_preference_signal * 15 +
  actionable_followup_signal * 10 +
  recurrence_signal * 10 +
  novelty_signal * 5
```

각 signal은 0~1 또는 0~N 정규화 값.

### 6.2 주요 signal 정의

#### A. explicit_memory_signal
사용자가 아래처럼 명시하면 가중치 높임.
- "기억해"
- "앞으로 이렇게 해"
- "이건 우리 규칙으로 하자"
- "이 설정 유지해"

#### B. long_term_project_signal
장기 프로젝트/로드맵/운영 방향 관련 내용.
예:
- 제품 전략
- 브랜치 정책
- 배포 구조
- 반복 작업 규칙

#### C. decision_made_signal
세션 중 확정된 결정이 있는가.
예:
- "dev 브랜치에서만 작업"
- "새벽 2시에 돌린다"
- "raw archive는 Supabase에 저장"

#### D. user_preference_signal
사용자의 선호/금지/스타일.
예:
- 응답 언어 선호
- 말투/포맷 선호
- 특정 경로/파일 건드리지 말기

#### E. actionable_followup_signal
미래 행동에 직접 영향을 주는가.
예:
- 지속적으로 참조할 운영 정책
- recurring task rule
- 추후 구현 범위

#### F. recurrence_signal
같은 주제/지시가 여러 세션에 반복되는가.
- 기존 memory와 매칭되면 recurrence 증가
- 반복될수록 stable memory일 가능성 높음

#### G. novelty_signal
기존 memory에 없는 새로운 사실인가.
- 이미 완전히 기록된 내용이면 novelty 낮음
- 새 프로젝트, 새 정책, 새 preference면 높음

### 6.3 세션 중요도 밴드

- `0 ~ 24`: `low`
- `25 ~ 49`: `medium`
- `50 ~ 74`: `high`
- `75 ~ 100`: `critical`

### 6.4 승격 규칙

#### 바로 승격 (`promote`)
다음 중 하나 이상 해당:
1. `importance_score >= 60`
2. 명시적 기억 요청 존재
3. 장기 프로젝트 상태/정책/선호/결정사항 포함
4. 기존 memory를 수정해야 하는 변화가 확인됨

#### 보류 (`defer` / `review_later`)
다음 조건:
- 중요하지만 확정되지 않음
- speculative discussion 위주
- 충돌하는 정보가 있음
- confidence 낮음

이 경우 `memory/inbox.md` 또는 DB candidate로만 저장.

#### archive only
- 단발성 Q&A
- 일회성 debugging
- 이미 memory에 충분히 반영된 중복 대화

#### reject / discard candidate
- 잡담 위주
- 정보 가치 없음
- 오탐 가능성이 높은 추출 결과

### 6.5 메모리 종류별 승격 규칙

| kind | 저장 위치 | 예시 |
|---|---|---|
| `user_preference` | `memory/preferences/*.md` | 응답 스타일, 호칭, 금지사항 |
| `project_state` | `memory/projects/*.md` | 제품 전략, 우선순위 |
| `decision` | `memory/decisions/YYYY-MM.md` 또는 프로젝트 파일 | 설계 확정, 운영 규칙 |
| `operation_rule` | `MEMORY.md`, `memory/operations/*.md` | cron, deploy, backup 정책 |
| `person_fact` | `memory/people/*.md` | 사용자 관련 안정 정보 |
| `todo` | 보통 승격하지 않음 | task system이 따로 있다면 그쪽 사용 |

### 6.6 dedupe / merge 규칙

entry slug 예시:
- `project:03_voxie:active-priorities`
- `preference:communication:call-user-master`
- `ops:openclaw:dream-job-run-at-2am-kst`

동일 slug 존재 시:
1. 내용이 같으면 source만 append
2. 내용이 유사하면 merge + `Last updated` 갱신
3. 내용이 충돌하면 기존 항목 유지 + inbox/review로 보냄

---

## 7. 삭제 / 보존 정책

v0는 "다 기억"도 아니고 "바로 삭제"도 아니다. **승격 여부와 민감도에 따라 계층적 보존**을 한다.

### 권장 retention class

#### `promoted`
대상:
- memory로 승격된 세션

정책:
- 세션 메타데이터 장기 보존
- raw transcript는 **90~365일** 보존 권장
- 아주 민감하지 않다면 최소 90일은 유지해 재처리 가능성 확보

#### `standard`
대상:
- 승격은 안 됐지만 향후 재평가 가능성 있는 일반 세션

정책:
- raw transcript **30~90일** 보존
- 이후 purge

#### `ephemeral`
대상:
- 단발성, 저가치, 잡담성 세션

정책:
- raw transcript **7~30일** 보존
- 요약도 남기지 않거나 짧은 summary만 유지

#### `sensitive_hold`
대상:
- 개인정보/시크릿 가능성이 감지된 세션

정책:
- 자동 승격 금지 또는 제한
- purge/보존 정책을 별도로 강화
- 필요 시 redaction 후 재처리

### 삭제 순서

1. raw transcript purge 예약
2. `dream_messages` 삭제 또는 compact export 후 삭제
3. `dream_sessions`는 최소 메타데이터만 남김
4. `dream_promotions`와 memory 파일의 출처 링크는 유지

### 남겨야 하는 최소 메타데이터

purge 후에도 아래는 남기는 것을 권장:
- `external_session_id`
- `started_at`, `ended_at`
- `importance_score`, `importance_band`
- `promotion_status`
- `purged_at`
- `transcript_checksum`

이렇게 하면 "무엇을 언제 왜 버렸는지" 감사 가능하다.

---

## 8. 안전장치 및 실패 복구 전략

Dream job은 밤에 도는 자동화이므로, 실패해도 조용히 데이터가 사라지면 안 된다.

### 8.1 Idempotency

필수 원칙:
- 같은 `job_date` 재실행 가능
- 같은 `external_session_id`는 upsert
- 같은 `entry_slug` 승격은 중복 생성 금지

구현 포인트:
- transcript checksum 비교
- `dream_jobs.job_date` unique
- `dream_promotions(entry_slug, session_id)` 또는 적절한 unique key

### 8.2 Two-phase 처리

권장 순서:
1. **archive 먼저 성공**
2. 그 다음 **analysis/promotion**

즉, raw가 저장되지 않았는데 memory만 갱신되는 상황을 피한다.

### 8.3 Write-ahead style 기록

job 단계마다 status 업데이트:
- `discovering`
- `archiving`
- `analyzing`
- `promoting`
- `forgetting`
- `completed`

문제 발생 시 어느 단계에서 멈췄는지 바로 확인 가능.

### 8.4 Partial failure 허용

예:
- 20개 세션 중 18개 성공, 2개 실패
- job 전체를 `partial`로 마킹
- 실패 세션만 다음 실행에서 재시도 가능

### 8.5 Memory 파일 백업

Markdown 파일 갱신 전:
- `memory/.snapshots/YYYY-MM-DD/` 에 백업 저장 또는
- git commit 기반 snapshot 남김

최소한 다음 중 하나 권장:
1. 파일 수정 전 `.bak` 생성
2. workspace를 git으로 관리하고 dream job 커밋 남기기

### 8.6 승격 전 검증

자동 승격 전 검증 항목:
- 빈 요약/의미 없는 문자열 금지
- 지나치게 긴 transcript 복붙 금지
- secret-like 패턴 포함 시 승격 차단
- 기존 memory와 충돌 시 `inbox`로 우회

### 8.7 관찰 가능성(Observability)

최소 로그:
- job 시작/종료 시각
- 세션 수집 수
- archive 성공/실패 수
- promotion 수
- purge 예약 수
- 예외 stack / failed session ids

권장 알림:
- 실패 또는 partial 시 OpenClaw 운영 채널/로그에 요약 남김

### 8.8 복구 시나리오

#### 시나리오 A. archive 중 실패
- 해당 세션 `archive_status = failed`
- 다음날 job 또는 수동 replay에서 재시도

#### 시나리오 B. archive 성공, promotion 실패
- raw는 이미 있으므로 분석/승격만 재실행 가능
- `analysis_status = failed`, `promotion_status = none`

#### 시나리오 C. memory 파일 손상
- snapshot 또는 git revert로 복원
- `dream_promotions` 기준 재구성 가능

#### 시나리오 D. 잘못된 승격
- promotion record를 보고 target file에서 롤백
- 향후 v1에서는 tombstone/retraction 지원 가능

---

## 9. OpenClaw cron 연동 방식 제안

요구사항은 "매일 새벽 2시경" 실행이다. v0에서는 OpenClaw의 기존 cron/daemon 운영 방식을 최대한 단순하게 이용한다.

### 권장 방식 A. OpenClaw cron → dream runner script

개념:
- OpenClaw cron이 매일 02:00 KST에 스크립트를 실행
- 스크립트가 Dream job 엔트리포인트를 호출

예시 흐름:
```text
OpenClaw cron
  → run dream-memory-nightly
    → discover yesterday sessions
    → archive to Supabase
    → analyze/promote
    → update memory files
    → mark retention/purge
```

### 엔트리포인트 제안

예시 명령:
```bash
node scripts/dream-memory/nightly.js --date yesterday --tz Asia/Seoul
```

또는
```bash
pnpm dream:nightly --date 2026-03-12
```

### 스크립트 모드 제안

- `--date YYYY-MM-DD`: 특정 날짜 재처리
- `--dry-run`: 파일/DB 쓰기 없이 분석만
- `--replay-failed`: 실패 세션만 재처리
- `--skip-purge`: 보존 정책 실행 생략
- `--limit N`: 테스트용 세션 제한

### Cron 등록 개념 예시

정확한 OpenClaw cron 서브커맨드는 환경에 맞춰 구현해야 하지만, 동작 개념은 아래와 같다.

```text
schedule: 0 2 * * *
timezone: Asia/Seoul
command: run dream-memory-nightly
```

### 권장 운영 흐름

1. 01:55 ~ 02:00 사이 다른 무거운 maintenance job과 겹치지 않게 조정
2. dream job 타임아웃 설정 (예: 20~40분)
3. 실패 시 재시도는 즉시 무한 반복보다 **다음 slot 또는 수동 replay** 권장
4. 성공/실패 결과를 로컬 로그 + Supabase job table에 모두 남김

### 환경 변수 제안

```env
DREAM_MEMORY_TZ=Asia/Seoul
DREAM_SUPABASE_URL=...
DREAM_SUPABASE_SERVICE_ROLE_KEY=...
DREAM_ARCHIVE_BUCKET=dream-archive
DREAM_RETENTION_EPHEMERAL_DAYS=14
DREAM_RETENTION_STANDARD_DAYS=60
DREAM_RETENTION_PROMOTED_DAYS=180
DREAM_MEMORY_ROOT=/Users/bini/.openclaw/workspace
```

---

## 10. v0 구현 범위 / v1 이후 확장

### v0 구현 범위

v0는 "작동하는 첫 번째 꿈"에 집중한다.

#### 포함
1. 전날 세션 수집
2. Supabase raw archive 적재
3. 세션 중요도 점수 계산
4. memory candidate 추출
5. `MEMORY.md` 및 `memory/*.md` 기본 승격
6. retention class / purge_after 계산
7. job status, 실패 로그, 재실행 가능 구조
8. 간단한 dedupe/merge 규칙

#### 제외
1. 실시간 memory update
2. 복잡한 semantic retrieval
3. vector DB 기반 장기기억 검색
4. 사용자 승인형 memory UI
5. 자동 redaction 파이프라인
6. cross-session entity graph

### v1 이후 확장 아이디어

#### v1.1
- vector embeddings 추가
- memory candidate와 기존 memory의 semantic dedupe 향상
- 더 정교한 sensitivity classification

#### v1.2
- human review inbox UI 또는 diff report
- "어젯밤의 꿈 요약" 일일 리포트 생성
- 잘못 승격된 기억 retract/tombstone 지원

#### v1.3
- memory freshness decay
- 오래된 기억의 자동 재검증
- recurring facts만 stable memory로 승격하는 강화 규칙

#### v2+
- 사람/프로젝트/결정 간 knowledge graph
- session-to-memory bidirectional navigation
- multi-agent memory partitioning (miku / meiko / kaito 등 역할별 view)

---

## 11. v0 구현 권장 순서

현실적인 개발 순서는 아래와 같다.

### Phase 1. Archive first
- session discovery 구현
- Supabase `dream_jobs`, `dream_sessions`, `dream_messages` 작성
- raw transcript export + checksum 저장

### Phase 2. Analyze second
- importance scoring 함수 구현
- candidate extraction JSON schema 정의
- `dream_memory_candidates` 적재

### Phase 3. Promote safely
- `MEMORY.md` / `memory/` 구조 초기화
- file writer with backup 구현
- `dream_promotions` 기록

### Phase 4. Forget carefully
- retention class 계산
- purge scheduler 또는 purge marker 구현
- 실제 삭제는 dry-run 검증 후 활성화

---

## 12. 예시: 한 세션이 어떻게 처리되는가

입력 세션:
- 사용자: "앞으로 OpenClaw는 dev 브랜치에서만 작업하고, 새벽 2시에 어제 세션을 정리하자. 중요한 건 MEMORY.md에 남겨줘."

처리 결과 예시:

### `dream_sessions`
```json
{
  "external_session_id": "agent:miku:discord:channel:1481895983720828998",
  "importance_score": 86,
  "importance_band": "critical",
  "promotion_status": "promoted",
  "retention_class": "promoted",
  "summary_short": "Dream Memory 운영 규칙과 dev 브랜치 원칙을 확정한 세션"
}
```

### `dream_memory_candidates`
```json
[
  {
    "kind": "operation_rule",
    "title": "Dream job runs at 2am KST",
    "summary": "OpenClaw는 매일 새벽 2시경 전날 세션을 수집해 raw archive와 memory promotion을 수행한다.",
    "decision": "promote",
    "reason_codes": ["decision_made", "long_term_project"]
  },
  {
    "kind": "operation_rule",
    "title": "Work on dev branch only",
    "summary": "모든 구현 작업은 dev 브랜치에서 진행하고 main 직접 push는 금지한다.",
    "decision": "promote",
    "reason_codes": ["explicit_rule", "recurrence"]
  }
]
```

### `MEMORY.md` 반영 예시
```md
## Operational Rules
- OpenClaw Dream Memory job runs nightly at ~02:00 KST to process the previous day's sessions.
  - Last promoted: 2026-03-13
  - Sources: session agent:miku:discord:channel:1481895983720828998

- All implementation work should happen on `dev`; direct push to `main` is disallowed.
  - Last promoted: 2026-03-13
  - Sources: AGENTS.md, session agent:miku:discord:channel:1481895983720828998
```

---

## 13. 최종 제안 요약

Dream Memory System v0는 아래 원칙으로 설계하는 것이 가장 현실적이다.

1. **모든 어제의 대화는 먼저 raw archive로 저장**한다.
2. 그 다음에만 **중요한 것만 장기 memory로 승격**한다.
3. memory는 DB가 아니라 **사람이 읽는 Markdown + 출처 추적 메타데이터** 중심으로 운영한다.
4. 중요하지 않은 세션은 **보존 기간 후 정리**하되, 최소 메타데이터는 남긴다.
5. 자동화는 반드시 **idempotent**, **partial failure tolerant**, **replayable** 해야 한다.
6. v0는 단순하고 명확하게 시작하고, semantic/graph/review UI는 v1 이후로 넘긴다.

이렇게 가면 "꿈처럼 되새기되, 운영은 차갑게" 라는 균형을 유지할 수 있다.
