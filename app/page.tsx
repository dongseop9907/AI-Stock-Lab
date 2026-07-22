import MarketSyncButton from "@/app/components/MarketSyncButton";
import {
  getLatestStockMarketRows,
  type StockMarketRow,
} from "@/lib/market/latest-snapshots";

export const dynamic = "force-dynamic";

function formatPrice(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatVolume(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat("ko-KR", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatChangeRate(value: number | null): string {
  if (value === null) {
    return "-";
  }

  const sign = value > 0 ? "+" : "";

  return `${sign}${value.toFixed(2)}%`;
}

function formatObservedAt(value: string | null): string {
  if (!value) {
    return "수집 전";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function Home() {
  let stocks: StockMarketRow[] = [];
  let errorMessage: string | null = null;

  try {
    stocks = await getLatestStockMarketRows();
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "주식 데이터를 불러오지 못했습니다.";
  }

  const syncedCount = stocks.filter(
    (stock) => stock.closePrice !== null,
  ).length;

  const risingCount = stocks.filter(
    (stock) =>
      stock.changeRate !== null &&
      stock.changeRate > 0,
  ).length;

  const fallingCount = stocks.filter(
    (stock) =>
      stock.changeRate !== null &&
      stock.changeRate < 0,
  ).length;

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
          <a href="#stocks">종목 시세</a>
          <a href="#predictions">AI 예측</a>
          <a href="#memory">경험 기억</a>
        </nav>

        <div className="sidebarNote">
          <span>현재 모드</span>
          <strong>시세 수집 단계</strong>
          <p>실계좌 주문 기능은 아직 비활성화되어 있습니다.</p>
        </div>
      </aside>

      <section className="content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">MARKET DATA</p>
            <h1>한국투자증권 시세 연동</h1>

            <p className="subcopy">
              한국투자증권 API에서 가져온 현재가를 Supabase에 저장하고
              대시보드에 표시합니다.
            </p>
          </div>

          <MarketSyncButton />
        </header>

        <div className="metricGrid">
          <article className="metricCard">
            <span>등록 종목</span>
            <strong>{stocks.length}</strong>
            <small>현재 분석 대상</small>
          </article>

          <article className="metricCard">
            <span>시세 수집 완료</span>
            <strong>{syncedCount}</strong>
            <small>최신 가격 데이터 보유</small>
          </article>

          <article className="metricCard">
            <span>상승 종목</span>
            <strong>{risingCount}</strong>
            <small>전일 대비 상승</small>
          </article>

          <article className="metricCard">
            <span>하락 종목</span>
            <strong>{fallingCount}</strong>
            <small>전일 대비 하락</small>
          </article>
        </div>

        <section className="panel" id="stocks">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">LATEST SNAPSHOTS</p>
              <h2>최신 종목 시세</h2>
            </div>

            <span className="statusPill">
              {errorMessage ? "연결 오류" : "KIS API 연결"}
            </span>
          </div>

          {errorMessage ? (
            <div className="emptyState">
              <h3>데이터를 불러오지 못했습니다.</h3>
              <p>{errorMessage}</p>
            </div>
          ) : stocks.length === 0 ? (
            <div className="emptyState">
              <h3>등록된 종목이 없습니다.</h3>
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>현재가</th>
                    <th>등락률</th>
                    <th>시가</th>
                    <th>고가</th>
                    <th>저가</th>
                    <th>거래량</th>
                    <th>수집 시각</th>
                  </tr>
                </thead>

                <tbody>
                  {stocks.map((stock) => {
                    const direction =
                      stock.changeRate === null
                        ? "flat"
                        : stock.changeRate > 0
                          ? "up"
                          : stock.changeRate < 0
                            ? "down"
                            : "flat";

                    return (
                      <tr key={stock.stockCode}>
                        <td>
                          <strong>{stock.stockName}</strong>
                          <br />
                          <small>
                            {stock.stockCode} · {stock.market}
                          </small>
                        </td>

                        <td>
                          <strong>
                            {formatPrice(stock.closePrice)}원
                          </strong>
                        </td>

                        <td>
                          <span className={`direction ${direction}`}>
                            {formatChangeRate(stock.changeRate)}
                          </span>
                        </td>

                        <td>{formatPrice(stock.openPrice)}</td>
                        <td>{formatPrice(stock.highPrice)}</td>
                        <td>{formatPrice(stock.lowPrice)}</td>
                        <td>{formatVolume(stock.volume)}</td>
                        <td>{formatObservedAt(stock.observedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="twoColumn">
          <section className="panel" id="predictions">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">NEXT STEP</p>
                <h2>AI 상승·하락 예측</h2>
              </div>
            </div>

            <div className="emptyState">
              <h3>예측 모델 준비 단계</h3>
              <p>
                저장된 가격·공시·재무 데이터를 기반으로 다음 거래일의
                방향을 예측하게 됩니다.
              </p>
            </div>
          </section>

          <section className="panel" id="memory">
            <div className="panelHeader">
              <div>
                <p className="eyebrow">PIPELINE</p>
                <h2>현재 개발 흐름</h2>
              </div>
            </div>

            <ol className="steps">
              <li>
                <span>1</span>
                <div>
                  <strong>종목 등록</strong>
                  <p>Supabase에 분석 종목 저장</p>
                </div>
              </li>

              <li>
                <span>2</span>
                <div>
                  <strong>실제 시세 수집</strong>
                  <p>한국투자증권 API 연동 완료</p>
                </div>
              </li>

              <li>
                <span>3</span>
                <div>
                  <strong>AI 예측 생성</strong>
                  <p>다음 개발 단계</p>
                </div>
              </li>

              <li>
                <span>4</span>
                <div>
                  <strong>결과 평가와 복기</strong>
                  <p>예측 성공·실패 원인 저장</p>
                </div>
              </li>
            </ol>
          </section>
        </div>
      </section>
    </main>
  );
}