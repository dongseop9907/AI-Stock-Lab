# v9.7.2 상세 원문 표본 수집기 — 이벤트 importer 구현 전 소스 확인

## 이번 자료에서 확인한 것

v9.7.1의 PARTIAL source coverage와 7개 유형의 후보를 확인했습니다.
후보 합계는 20,181개: 현금배당 9,474, 유상증자 8,255, 합병 1,405,
주식병합 504, 회사분할 313, 주식분할 117, 주식배당 113입니다.

제3자배정·일반공모, 종속회사, 정정·철회, 거래정지 안내가 섞여 있으므로
제목을 확정 이벤트로 변환할 수 없습니다. 영문 포함 종목코드 0001A0도 보존해야 합니다.
이 도구는 사용자가 전달한 21개 표본에 대해 실제 상세 소스의 제공 여부와 원문을 확인합니다.
**v9.7.2 이벤트 importer 완성본이 아니며, corporate_action_events에는 쓰지 않습니다.**

## 실행

ZIP의 scripts 폴더를 기존 ai-stock-lab 폴더에 그대로 복사하세요.
추가 패키지 설치, SQL 실행, 개발 서버 실행은 필요하지 않습니다.
기존 .env.local 또는 환경변수의 OpenDART 키를 사용합니다.
키 이름: OPENDART_API_KEY / OPEN_DART_API_KEY / DART_API_KEY / DART_KEY / OPEN_DART_KEY.
Supabase에는 연결하지 않습니다.

프로젝트 PowerShell에서:

```powershell
cd C:\Users\user\Desktop\ai-stock-lab
node .\scripts\collect-corporate-action-details-v9-7-2.cjs
```

끝나면 다음 파일 **하나만** 채팅에 첨부하세요.

```text
C:\Users\user\Desktop\ai-stock-lab\logs\corporate-action-detail-probe-v9-7-2.json
```

로그에 PROBE_FINISHED가 나오더라도 모든 원문이 있다는 뜻은 아닙니다.
SOURCE_UNAVAILABLE 등이 있는 경우에도 보고서를 보내주세요. 대체 소스가 필요한 유형을 확인할 수 있습니다.
원문은 보고서의 rawBase64에 포함되어 있으므로 별도 압축/다운로드 작업이 필요하지 않습니다.
보고서에는 후보 메타데이터, 상태 코드, 공개 응답과 SHA-256을 저장합니다. .env 파일이나 API 인증키는 포함하지 않습니다.

## 수집 정책

- 21개 표본의 document.xml을 접수번호로 조회하여 반환 ZIP을 보관합니다.
- 합병·분할·유상증자 유형은 해당 주요사항보고서 구조화 API도 조회합니다.
- 구조화 API는 최초접수일 기준이므로 2015-01-01부터 표본 접수일까지 조회한 뒤 **동일 법인·동일 접수번호**로 대조합니다.
- 다른 접수번호의 자료를 요청한 공시의 상세 데이터로 대체하지 않습니다.
- 연간 배당 총액이나 공시 접수일을 개별 배당금·효력일로 사용하지 않습니다.
- document.xml의 013/014는 SOURCE_UNAVAILABLE로 기록하며 이벤트 부재를 증명하지 않습니다.
- 구조화 응답의 정확한 접수번호 일치도 이벤트 실행 여부·당시 이용 가능성·전체 커버리지를 증명하지 않습니다.
- ZIP은 컨테이너 구조와 해시만 확인합니다. XML 본문 구조·의미·CRC 전체 검증은 후속 파서 단계에서 해야 합니다.
- 이 도구는 현재 후보 표본만 봅니다. 날짜 경계 바깥 공시, 상장폐지·시장 이전, 전체 PIT 대사, 완전한 정정·철회 연결은 아직 해결하지 않습니다.
- DB 변경, 이벤트 입력, 가격 보정, COMPLETE 승격을 하지 않습니다.

## 중단 및 재개

각 응답 뒤 JSON을 임시 파일로 저장한 후 교체합니다. 같은 명령을 다시 실행하면 해시가 맞는 기존 응답을 재사용합니다.
오류 항목은 재시도합니다. NO_STRUCTURED_DATA/SOURCE_UNAVAILABLE를 다시 조회하려면:

```powershell
node .\scripts\collect-corporate-action-details-v9-7-2.cjs --refresh
```

같은 출력 파일에 대해 여러 실행을 동시에 시작하지 마세요.
020은 요청 제한, 010/011/012/901은 인증/계정/IP 관련 문제라 즉시 중단합니다.
설정을 수정하거나 제한 해제 후 같은 명령으로 재개합니다. 오류 본문/URL은 인증키 노출을 막기 위해 출력·저장하지 않습니다.

응답당 8 MiB, 보고서의 원본 바이트 합계 20 MiB 제한을 둡니다. BUNDLE_SIZE_LIMIT이면 저장된 보고서를 보내주세요.
소스가 실제로 원문을 제공하지 않을 수 있으므로, 전 유형에 대한 원문 수집 성공이나 전체 기업행동 커버리지를 보장하지 않습니다.

## 검증

```powershell
node --test .\tests\corporate-action-detail-probe-v9-7-2.test.cjs
```

제작 환경 Node.js에서 16개 테스트 통과:
영문 종목코드, 잘못된 식별자/날짜, 정정·철회·다른 법인 범위, ZIP 컨테이너,
원문 부재/요청 제한, 접수번호·법인 대조, 키 제외, 응답 크기 제한, 중단·재개, 캐시 해시 변조 검출.
실제 인증된 OpenDART 요청은 여기서 실행하지 않았습니다.

## 공식 계약 출처

- 원문 ZIP: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019003
- 유상증자: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS005&apiId=2020023
- 유무상증자: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS005&apiId=2020025
- 합병: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS005&apiId=2020050
- 분할: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS005&apiId=2020051
- 분할합병: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS005&apiId=2020052
