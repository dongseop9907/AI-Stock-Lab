import { getActiveStocks, type StockRow } from "@/lib/stocks";

export const dynamic = "force-dynamic";

export default async function Home() {
  let stocks: StockRow[] = [];
  let errorMessage: string | null = null;

  try {
    stocks = await getActiveStocks();
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "종목 데이터를 불러오지 못했습니다.";
  }

  const kospiCount = stocks.filter(
    (stock) => stock.market.toUpperCase() === "KOSPI",
  ).length;

  const kosdaqCount = stocks.filter(
    (stock) => stock.market.toUpperCase() === "KOSDAQ",
  ).length;

  const sectorCount = new Set(
    stocks
      .map((stock) => stock.sector)
      .filter((sector): sector is string => Boolean(sector)),
  ).size;

  const today = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">A</span>

          <div>
            <strong>AI Stock Lab</strong>
            <small>자기평가형 투자 연구</small>
          </div>
        </div>

        <nav>
          <a className="active" href="#overview">
            대시보드
          </a>
          <a href="#stocks">등록 종목</a>
          <a href="#predictions">오늘의 예측</a>
          <a href="#memory">경험 기억</a>
          <a href="#trading">모의·실거래</a>
        </nav>

        <div className="sidebarNote">
          <span>현재 모드</span>
          <strong>연구·가상투자</strong>
          <p>실계좌 주문은 비활성화되어 있습니다.</p>
        </div>
      </aside>

      <section className="content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">{today} 데이터베이스 현황</p>
            <h1>Supabase 종목 데이터가 연결되었습니다.</h1>
            <p className="subcopy">
              등록된 종목을 기반으로 시세·공시·예측 데이터를 순차적으로
              수집합니다.
            </p>
          </div>

          <button className="primaryButton" type="button">
            종목 데이터 동기화
          </button>
        </header>

        <div className="metricGrid">
          <article className="metricCard">
            <span>등록 종목</span>
            <strong>{stocks.length}</strong>
            <small>Supabase stocks 테이블</small>
          </article>

          <article className="metricCard">
            <span>KOSPI</span>
            <strong>{kospiCount}</strong>
            <small>등록된 코스피 종목</small>
          </article>

          <article className="metricCard">
            <span>KOSDAQ</span>
            <strong>{kosdaqCount}</strong>
            <small>등록된 코스닥 종목</small>
          </article>

          <article className="metricCard">
            <span>산업 분야</span>
            <strong>{sectorCount}</strong>
            <small>중복을 제외한 업종 수</small>
          </article>
        </div>

        <section className="panel" id="stocks">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">STOCK UNIVERSE</p>
              <h2>분석 대상 종목</h2>
            </div>

            <span className="statusPill">
              {errorMessage ? "연결 오류" : "Supabase 연결"}
            </span>
          </div>

          {errorMessage ? (
            <div className="emptyState">
              <h3>종목을 불러오지 못했습니다.</h3>
              <p>{errorMessage}</p>
            </div>
          ) : stocks.length === 0 ? (
            <div className="emptyState">
              <h3>등록된 종목이 없습니다.</h3>
              <p>Supabase의 stocks 테이블에 종목을 추가해 주세요.</p>
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>종목명</th>
                    <th>종목코드</th>
                    <th>시장</th>
                    <th>업종</th>
                    <th>상태</th>
                  </tr>
                </thead>

                <tbody>
                  {stocks.map((stock) => (
                    <tr key={stock.stock_code}>
                      <td>
                        <strong>{stock.stock_name}</strong>
                      </td>
                      <td>{stock.stock_code}</td>
                      <td>{stock.market}</td>
                      <td>{stock.sector ?? "미분류"}</td>
                      <td>
                        <span className="direction up">
                          {stock.is_active ? "분석 중" : "비활성"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="twoColumn">
          <section className="panel" id="predictions">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">PREDICTIONS</p>
                <h2>AI 예측</h2>
              </div>
            </div>

            <div className="emptyState">
              <div className="orb" />
              <h3>예측 데이터가 아직 없습니다.</h3>
              <p>
                다음 단계에서 종목별 상승·하락 예측을 생성하고 저장합니다.
              </p>
            </div>
          </section>

          <section className="panel" id="memory">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">MEMORY</p>
                <h2>투자 경험 기억</h2>
              </div>
            </div>

            <ol className="steps">
              <li>
                <span>1</span>
                <div>
                  <strong>종목 데이터 수집</strong>
                  <p>가격·거래량·공시·재무정보 저장</p>
                </div>
              </li>

              <li>
                <span>2</span>
                <div>
                  <strong>사전 예측 생성</strong>
                  <p>예상 방향·확률·근거·위험요인 저장</p>
                </div>
              </li>

              <li>
                <span>3</span>
                <div>
                  <strong>결과 평가</strong>
                  <p>실제 수익률과 시장 대비 성과 측정</p>
                </div>
              </li>

              <li>
                <span>4</span>
                <div>
                  <strong>성공·실패 복기</strong>
                  <p>과거 경험을 다음 판단에 반영</p>
                </div>
              </li>
            </ol>
          </section>
        </div>

        <section className="panel architecture" id="trading">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">CURRENT PIPELINE</p>
              <h2>현재 개발 상태</h2>
            </div>
          </div>

          <div className="flow">
            <div>
              <strong>Supabase</strong>
              <span>종목 기본정보</span>
            </div>

            <i>→</i>

            <div>
              <strong>시세 수집</strong>
              <span>다음 개발 단계</span>
            </div>

            <i>→</i>

            <div>
              <strong>AI 예측</strong>
              <span>방향·확률·근거</span>
            </div>

            <i>→</i>

            <div>
              <strong>성과 평가</strong>
              <span>성공·실패 분석</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}