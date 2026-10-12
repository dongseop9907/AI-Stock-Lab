# v9.7.1 DB 기반 OpenDART 소스 목록 수집

이번 패치는 제공받은 최신 프로젝트의 migration 060 이후에 추가하는 파일만 포함합니다.
기존 v9.7.1 PowerShell 목록 수집 스크립트는 그대로 두고, DB 기반으로 페이지별 저장·재개하는 경로를 추가합니다.
**v9.7 전체 완성이나 v9.7.2 이벤트 importer가 아닙니다.** 실제 DB/API 실행 결과는 사용자 환경에서 확인해야 합니다.

## 설치 및 실행

1. ZIP 안의 파일을 현재 `ai-stock-lab` 프로젝트 최상위에 구조 그대로 복사합니다.
2. Supabase SQL Editor에서 `supabase/migrations/061_corporate_action_source_inventory_v9_7_1.sql` 전체를 실행합니다. 한 번만 적용합니다.
3. 같은 SQL Editor에서 `verification/verify-corporate-action-source-v9-7-1.sql` 전체를 실행합니다. 테스트는 합성 데이터를 한 트랜잭션 안에서 만들고 마지막에 **ROLLBACK**합니다. NOTICE의 PASS를 확인합니다. 이 테스트 파일을 migrations 폴더에 넣지 마세요.
4. 프로젝트 PowerShell에서 실행합니다.

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\initialize-corporate-action-source-v9-7-1.ps1
```

이 명령은 `.env.local`에 수집 API 인증 토큰을 한 번 생성합니다. 기존 유효한 토큰은 유지합니다.
기존 Supabase 환경변수와 OpenDART API 키가 필요합니다. OpenDART 키는 기존 이름 중 하나를 그대로 사용합니다:
`OPENDART_API_KEY`, `OPEN_DART_API_KEY`, `DART_API_KEY`, `DART_KEY`, `OPEN_DART_KEY`.
키를 채팅으로 보낼 필요는 없습니다.

5. 개발 서버를 재시작합니다. 첫 PowerShell 창:

```powershell
npm run dev -- --port 3000
```

6. 두 번째 PowerShell 창에서 우선 5페이지만 수집합니다.

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\run-corporate-action-source-db-v9-7-1.ps1 -BaseUrl http://localhost:3000 -MaxPages 5
```

성공하면 같은 state 파일로 전체 범위를 이어서 진행합니다.

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\run-corporate-action-source-db-v9-7-1.ps1 -BaseUrl http://localhost:3000
```

기간 기본값은 2023-01-02~2026-07-31, 대상은 Y/K(KOSPI/KOSDAQ), 구간은 30일입니다.
3001/3010 서버를 사용한다면 BaseUrl도 그 포트로 바꿉니다.
`Ctrl+C`나 네트워크 실패 후 동일 명령으로 재개할 수 있습니다. DB가 페이지 진행 상태의 기준입니다.
기존 로컬 v9.7.1 state/candidates는 페이지 원본·응답 합계 검증 기록이 부족하므로 자동 승계하지 않습니다.

## 결과 확인

```sql
select id, status, start_date, end_date, stored_pages,
       disclosure_count, candidate_count, chunk_start, corp_cls, next_page,
       source_coverage_window_id
from public.corporate_action_source_inventory_runs
order by created_at desc limit 5;

select id, provider, coverage_status, markets, action_types, evidence
from public.corporate_action_source_coverage_windows
where provider_version = 'V9_7_1_DB_INVENTORY'
order by created_at desc limit 5;
```

완료 시 기대값:

- inventory run: `INVENTORY_COMPLETE`
- source coverage: **`PARTIAL`**
- action_types: `[]` — 이벤트 커버리지를 입증한 유형은 아직 없음
- corporate_action_events: 이 패치가 추가하는 이벤트 0건
- 현재 v9.7 evaluator: `BLOCKED_SOURCE_COVERAGE` 유지

candidate_count는 제목으로 분류한 **유형별 후보 힌트 수**입니다. 한 공시가 여러 유형에 포함될 수 있으며 확정 이벤트 건수가 아닙니다.
전체 공시 행과 원본 응답 JSON, 응답 SHA-256을 저장하므로 제목 매칭에 실패한 공시도 나중에 재검토할 수 있습니다.
완료된 source fingerprint는 정해진 순서의 페이지 응답 해시를 다시 SHA-256한 값입니다.
동일한 원본 결과를 재수집하면 기존 source snapshot을 공유하며 evidence의 inventoryRunId는 처음 저장한 run을 가리킬 수 있습니다.

## 다음 v9.7.2에서 해결할 항목

OpenDART 목록의 날짜는 **공시 접수일**입니다. 이를 효력일·권리락일·배당락일로 복사하지 않습니다.
Y/K 목록 조회만으로 과거 PIT 종목 전체(상장폐지·시장 이전 포함)의 이벤트 커버리지를 입증하지 않습니다.
7가지 제목 힌트는 완전한 탐지 규칙이 아닙니다. 본문, 정정·철회 연결, 효력일, 조정 비율·현금액, 실행 여부를 검증해야 합니다.
특히 기간 이전에 공시됐지만 기간 안에 효력이 발생한 이벤트, 기간 후 정정, 당시 이용 가능 시점도 처리해야 합니다.
기존 v9.4의 자동 가격 조정은 STOCK_SPLIT/REVERSE_SPLIT만 지원합니다. 나머지 이벤트를 기록해도 조정 엔진 지원이 자동으로 생기지 않습니다.
실제 원본 표본과 필요한 추가 소스를 확인한 다음 각 유형 importer를 구현해야 합니다. 이 패치는 COMPLETE/assertion 생성 API를 제공하지 않습니다.

## 오류와 복구

- DART_STATUS_020: 요청 제한. 중단 후 사용량/제한 해제 여부를 확인하고 같은 명령으로 재개.
- DART_STATUS_010/011/012/901: 키·IP·계정 문제. 설정 수정 후 재개.
- DART_NETWORK_FAILURE/HTTP/INVALID_JSON: 저장되지 않은 페이지에서 중단. 상태 확인 후 재개.
- SOURCE_TOTAL_CHANGED_START_NEW_RUN / DUPLICATE_RECEIPT_START_NEW_RUN: 검색 결과가 이동했거나 중복됨. 기존 run을 완료 처리하지 말고, 새로운 `-StatePath`로 새 run 시작. 반복되면 실제 응답 검토 필요.
- 서버 재시작 뒤 401: 서버와 스크립트가 같은 토큰을 읽는지 확인. shell 환경변수가 파일 값보다 우선합니다.
- CREATE_FAILED_CHECK_MIGRATION_061: migration 적용과 Supabase 서버 환경변수 확인.

새 API는 `Authorization: Bearer <CORPORATE_ACTION_IMPORT_TOKEN>`을 요구합니다.
DB 테이블은 RLS 활성화, anon/authenticated 권한 제거, 새 RPC는 service_role만 실행할 수 있습니다.
기존 프로젝트의 다른 API 인증 정책까지 변경하는 패치는 아닙니다.

## 검증

```powershell
node .\scripts\test-corporate-action-source-v9-7-1.cjs
npx tsc --project .\tsconfig.v9-7-1-check.json
```

제작 환경에서 19개 독립 테스트와 추가 파일의 TypeScript 검사를 통과했습니다.
검증한 내용: 잘못된 날짜, 누락 페이지, 중복 행, 시장/기간 불일치, 빈 후속 페이지, API 오류·인증키 노출 방지, 제목 힌트와 이벤트 분리.
**실제 OpenDART 인증 호출, Supabase migration/RPC 실행, Windows PowerShell 실행은 여기서 수행하지 못했습니다.**
전체 프로젝트 빌드 통과를 의미하지 않습니다. SQL 트랜잭션 테스트 파일은 사용자 DB에서 실행할 검증 도구이며 제작 환경에서는 미실행입니다.

공식 API 계약 확인: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001
(접수일 기준, 법인구분 Y/K, 페이지당 최대 100, 정정 포함 N, 회사코드 없는 조회는 3개월 제한)
