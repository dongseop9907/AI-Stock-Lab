# AI Stock Lab

예측하고, 결과를 평가하고, 성공·실패 원인을 기억해 다음 판단에 활용하는 웹 기반 AI 투자 연구 시스템의 첫 번째 MVP입니다.

## 현재 포함된 기능

- Next.js App Router 기반 반응형 대시보드
- 오늘의 종목 예측 데모 화면
- 예측·결과·복기·주문을 분리한 Supabase 스키마
- OpenDART 공시 조회 클라이언트 뼈대
- 한국투자증권 접근토큰·국내주식 현재가 조회 클라이언트 뼈대
- pgvector 기반 성공·실패 경험 검색용 컬럼
- 실거래와 모의투자를 구분하는 주문 데이터 구조

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 권장 개발 순서

1. Supabase 프로젝트 생성 후 `supabase/migrations/001_initial_schema.sql` 실행
2. OpenDART 인증키 발급 후 공시 수집 배치 구현
3. 국내 종목 마스터와 일봉 데이터 적재
4. 장 시작 전 사전 예측 생성 및 고정
5. 1·5·20·60일 결과 자동 평가
6. LLM 사후 복기와 pgvector 유사 사례 검색
7. 모의투자 연동
8. 충분한 검증 후 극소액 실거래 활성화

## 보안 원칙

- API 키와 계좌정보를 GitHub에 올리지 않습니다.
- 증권사 키는 브라우저로 보내지 않고 서버에서만 사용합니다.
- 처음에는 `PAPER` 모드만 허용합니다.
- 실거래 활성화 시 주문 금액 상한과 긴급 중지 스위치를 별도로 둡니다.

## 다음 구현 목표

- `/api/analysis/run`: 장 전 전 종목 분석 배치 시작
- `/api/outcomes/evaluate`: 예측 만기 성과 계산
- `/api/memories/search`: 유사 성공·실패 경험 검색
- `/api/paper/orders`: 가상 주문 생성
- 관리자 페이지에서 전략 버전과 성능 비교
