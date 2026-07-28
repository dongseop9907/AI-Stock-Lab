import TradeHistoryPanel from "@/app/components/TradeHistoryPanel";
import PaperPortfolioPanel from "@/app/components/PaperPortfolioPanel";
import EntrySignalPanel from "@/app/components/EntrySignalPanel";
import TradingMaintenanceButton from "@/app/components/TradingMaintenanceButton";
import MarketSyncButton from "@/app/components/MarketSyncButton";
import ModelPerformancePanel from "@/app/components/ModelPerformancePanel";

import {
  getTradeHistoryDashboard,
  type TradeHistoryDashboard,
} from "@/lib/trading/get-trade-history-dashboard";

import {
  getPaperAccountDashboard,
  type PaperAccountDashboard,
} from "@/lib/trading/get-paper-account-dashboard";

import {
  getEntrySignalDashboardData,
  type EntryModelOption,
  type EntrySignalDashboardRow,
} from "@/lib/trading/get-entry-signal-dashboard";

import {
  getLatestStockMarketRows,
  type StockMarketRow,
} from "@/lib/market/latest-snapshots";

import {
  getModelPerformance,
  type ModelPerformance,
} from "@/lib/models/get-model-performance";

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

function getDirectionClass(
  changeRate: number | null,
): "up" | "down" | "flat" {
  if (changeRate === null || changeRate === 0) {
    return "flat";
  }

  return changeRate > 0 ? "up" : "down";
}

export default async function Home() {

  let tradeHistory: TradeHistoryDashboard | null = null;

  let tradeHistoryErrorMessage: string | null = null;

  let paperAccount:PaperAccountDashboard | null = null;
  let paperAccountErrorMessage: string | null = null;

  let stocks: StockMarketRow[] = [];
  let models: ModelPerformance[] = [];

  let entrySignals:
  EntrySignalDashboardRow[] = [];

  let entryModels:
  EntryModelOption[] = [];

  let marketErrorMessage: string | null = null;
  let modelErrorMessage: string | null = null;
  let signalErrorMessage: string | null = null;

  const [
  marketResult,
  modelResult,
  signalResult,
  paperAccountResult,
  tradeHistoryResult,
] = await Promise.allSettled([
  getLatestStockMarketRows(),
  getModelPerformance(),
  getEntrySignalDashboardData(),
  getPaperAccountDashboard(),
  getTradeHistoryDashboard(),
]);

if (
  tradeHistoryResult.status ===
  "fulfilled"
) {
  tradeHistory =
    tradeHistoryResult.value;
} else {
  tradeHistoryErrorMessage =
    tradeHistoryResult.reason instanceof Error
      ? tradeHistoryResult.reason.message
      : "거래 이력을 불러오지 못했습니다.";
}

if (
  paperAccountResult.status ===
  "fulfilled"
) {
  paperAccount =
    paperAccountResult.value;
} else {
  paperAccountErrorMessage =
    paperAccountResult.reason instanceof Error
      ? paperAccountResult.reason.message
      : "모의계좌를 불러오지 못했습니다.";
}

  if (marketResult.status === "fulfilled") {
    stocks = marketResult.value;
  } else {
    marketErrorMessage =
      marketResult.reason instanceof Error
        ? marketResult.reason.message
        : "주식 데이터를 불러오지 못했습니다.";
  }

  if (modelResult.status === "fulfilled") {
    models = modelResult.value;
  } else {
    modelErrorMessage =
      modelResult.reason instanceof Error
        ? modelResult.reason.message
        : "모델 성과를 불러오지 못했습니다.";
  }

  if (
    signalResult.status === "fulfilled" 
  ) {
    entrySignals =
      signalResult.value.signals;

    entryModels =
      signalResult.value.models;
  } else {
    signalErrorMessage =
      signalResult.reason instanceof Error
        ? signalResult.reason.message
        : "진입 신호를 불러오지 못했습니다.";
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

  const approvedModelCount = models.filter(
    (model) => model.status === "APPROVED",
  ).length;

  const candidateModelCount = models.filter(
    (model) => model.status === "CANDIDATE",
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

          <a href="#stocks">
            종목 시세
          </a>

          <a href="#entry-signals">
            진입 신호
          </a>

          <a href="#paper-portfolio">
            모의계좌
          </a>

          <a href="#trade-history">
            거래 이력
          </a>

          <a href="#model-performance">
            모델 성과
          </a>

          <a href="#predictions">
            AI 예측
          </a>

          <a href="#risk-management">
            위험관리
          </a>

          <a href="#memory">
            경험 기억
          </a>
        </nav>

        <div className="sidebarNote">
          <span>현재 모드</span>
          <strong>모의투자·모델 검증</strong>

          <p>
            위험관리 승인을 통과한 주문만
            모의체결할 수 있습니다.
          </p>
        </div>
      </aside>

      <section
        className="content"
        id="overview"
      >
        <header className="topbar">
          <div>
            <p className="eyebrow">
              AI TRADING RESEARCH
            </p>

            <h1>
              자기평가형 AI 투자 시스템
            </h1>

            <p className="subcopy">
              실제 시장 데이터를 수집하고
              모델별 주문·수익·손절 품질을
              비교합니다.
            </p>
          </div>

          <div className="topbarActions">
            <MarketSyncButton />
            <TradingMaintenanceButton />
          </div>
        </header>

        <div className="metricGrid">
          <article className="metricCard">
            <span>등록 종목</span>

            <strong>
              {stocks.length}
            </strong>

            <small>
              현재 분석 대상
            </small>
          </article>

          <article className="metricCard">
            <span>시세 수집 완료</span>

            <strong>
              {syncedCount}
            </strong>

            <small>
              최신 가격 데이터 보유
            </small>
          </article>

          <article className="metricCard">
            <span>승인 모델</span>

            <strong>
              {approvedModelCount}
            </strong>

            <small>
              검증을 통과한 모델
            </small>
          </article>

          <article className="metricCard">
            <span>후보 모델</span>

            <strong>
              {candidateModelCount}
            </strong>

            <small>
              모의투자 검증 중
            </small>
          </article>
        </div>

        <section
          className="panel"
          id="stocks"
        >
          <div className="panelHeader">
            <div>
              <p className="eyebrow">
                LATEST SNAPSHOTS
              </p>

              <h2>
                최신 종목 시세
              </h2>

              <p className="subcopy">
                한국투자증권 API에서 수집해
                Supabase에 저장한 시세입니다.
              </p>
            </div>

            <span className="statusPill">
              {marketErrorMessage
                ? "시세 조회 오류"
                : "KIS API 연결"}
            </span>
          </div>

          {marketErrorMessage ? (
            <div className="emptyState">
              <h3>
                종목 시세를 불러오지
                못했습니다.
              </h3>

              <p>
                {marketErrorMessage}
              </p>
            </div>
          ) : stocks.length === 0 ? (
            <div className="emptyState">
              <h3>
                등록된 종목이 없습니다.
              </h3>

              <p>
                Supabase의 stocks 테이블에
                분석 종목을 등록해 주세요.
              </p>
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
                      getDirectionClass(
                        stock.changeRate,
                      );

                    return (
                      <tr key={stock.stockCode}>
                        <td>
                          <strong>
                            {stock.stockName}
                          </strong>

                          <br />

                          <small>
                            {stock.stockCode}
                            {" · "}
                            {stock.market}
                            {stock.sector
                              ? ` · ${stock.sector}`
                              : ""}
                          </small>
                        </td>

                        <td>
                          {stock.closePrice ===
                          null ? (
                            "-"
                          ) : (
                            <strong>
                              {formatPrice(
                                stock.closePrice,
                              )}
                              원
                            </strong>
                          )}
                        </td>

                        <td>
                          <span
                            className={`direction ${direction}`}
                          >
                            {formatChangeRate(
                              stock.changeRate,
                            )}
                          </span>
                        </td>

                        <td>
                          {formatPrice(
                            stock.openPrice,
                          )}
                        </td>

                        <td>
                          {formatPrice(
                            stock.highPrice,
                          )}
                        </td>

                        <td>
                          {formatPrice(
                            stock.lowPrice,
                          )}
                        </td>

                        <td>
                          {formatVolume(
                            stock.volume,
                          )}
                        </td>

                        <td>
                          {formatObservedAt(
                            stock.observedAt,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

                      <EntrySignalPanel
  signals={entrySignals}
  models={entryModels}
  errorMessage={signalErrorMessage}
/>

<PaperPortfolioPanel
  data={paperAccount}
  errorMessage={
    paperAccountErrorMessage
  }
/>

<TradeHistoryPanel
  data={tradeHistory}
  errorMessage={
    tradeHistoryErrorMessage
  }
/>

<ModelPerformancePanel
  models={models}
  errorMessage={modelErrorMessage}
/>

        <div className="metricGrid">
          <article className="metricCard">
            <span>상승 종목</span>

            <strong>
              {risingCount}
            </strong>

            <small>
              전일 대비 상승
            </small>
          </article>

          <article className="metricCard">
            <span>하락 종목</span>

            <strong>
              {fallingCount}
            </strong>

            <small>
              전일 대비 하락
            </small>
          </article>

          <article className="metricCard">
            <span>보합·미수집</span>

            <strong>
              {Math.max(
                0,
                stocks.length -
                  risingCount -
                  fallingCount,
              )}
            </strong>

            <small>
              변화 없음 또는 데이터 부족
            </small>
          </article>

          <article className="metricCard">
            <span>전체 모델</span>

            <strong>
              {models.length}
            </strong>

            <small>
              후보·승인·거절·은퇴 포함
            </small>
          </article>
        </div>

        <div className="twoColumn">
          <section
            className="panel"
            id="predictions"
          >
            <div className="panelHeader">
              <div>
                <p className="eyebrow">
                  PREDICTIONS
                </p>

                <h2>
                  AI 종목 예측
                </h2>
              </div>

              <span className="statusPill">
                개발 중
              </span>
            </div>

            <div className="emptyState">
              <div className="orb" />

              <h3>
                예측 데이터 연결 단계
              </h3>

              <p>
                뉴스·공시·수급·시장 데이터와
                가격 흐름을 조합해 후보 종목과
                상승 가능성을 계산합니다.
              </p>
            </div>
          </section>

          <section
            className="panel"
            id="risk-management"
          >
            <div className="panelHeader">
              <div>
                <p className="eyebrow">
                  RISK ENGINE
                </p>

                <h2>
                  위험관리 원칙
                </h2>
              </div>

              <span className="statusPill">
                강제 적용
              </span>
            </div>

            <ol className="steps">
              <li>
                <span>1</span>

                <div>
                  <strong>
                    최초 손절가 검증
                  </strong>

                  <p>
                    매수가 대비 손절 거리와
                    예상 손실액을 검사합니다.
                  </p>
                </div>
              </li>

              <li>
                <span>2</span>

                <div>
                  <strong>
                    주문 수량 제한
                  </strong>

                  <p>
                    계좌 자산과 종목 비중에
                    따라 최대 수량을 결정합니다.
                  </p>
                </div>
              </li>

              <li>
                <span>3</span>

                <div>
                  <strong>
                    분산투자 제한
                  </strong>

                  <p>
                    전체 투자 비중과 동일 업종
                    집중도를 제한합니다.
                  </p>
                </div>
              </li>

              <li>
                <span>4</span>

                <div>
                  <strong>
                    손절가 하향 금지
                  </strong>

                  <p>
                    매수 후 손절가는 유지하거나
                    위로만 이동합니다.
                  </p>
                </div>
              </li>
            </ol>
          </section>
        </div>

        <section
          className="panel architecture"
          id="memory"
        >
          <div className="panelHeader">
            <div>
              <p className="eyebrow">
                SELF-EVALUATION PIPELINE
              </p>

              <h2>
                자기평가형 학습 흐름
              </h2>

              <p className="subcopy">
                모델의 판단과 거래 결과를
                연결해 다음 모델 검증에
                활용합니다.
              </p>
            </div>
          </div>

          <div className="flow">
            <div>
              <strong>
                시장 데이터
              </strong>

              <span>
                뉴스·공시·수급·가격
              </span>
            </div>

            <i>→</i>

            <div>
              <strong>
                AI 판단
              </strong>

              <span>
                후보·진입·손절 제안
              </span>
            </div>

            <i>→</i>

            <div>
              <strong>
                위험 검증
              </strong>

              <span>
                수량·손실·분산 제한
              </span>
            </div>

            <i>→</i>

            <div>
              <strong>
                모의체결
              </strong>

              <span>
                현금·포지션 갱신
              </span>
            </div>

            <i>→</i>

            <div>
              <strong>
                사후 평가
              </strong>

              <span>
                수익·손절 품질 저장
              </span>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">
                TRADING PRINCIPLES
              </p>

              <h2>
                최종 매매 원칙
              </h2>
            </div>
          </div>

          <ol className="steps">
            <li>
              <span>1</span>

              <div>
                <strong>
                  후보 종목 선정
                </strong>

                <p>
                  AI가 뉴스·공시·수급·시장
                  데이터를 분석합니다.
                </p>
              </div>
            </li>

            <li>
              <span>2</span>

              <div>
                <strong>
                  매수 시점 판단
                </strong>

                <p>
                  체결가·거래량·호가 흐름으로
                  진입 여부를 판단합니다.
                </p>
              </div>
            </li>

            <li>
              <span>3</span>

              <div>
                <strong>
                  최초 손절가 계산
                </strong>

                <p>
                  매수 전에 AI가 손절가를
                  제안하고 위험관리 엔진이
                  검증합니다.
                </p>
              </div>
            </li>

            <li>
              <span>4</span>

              <div>
                <strong>
                  분산투자
                </strong>

                <p>
                  종목·업종·전체 투자 비중을
                  제한합니다.
                </p>
              </div>
            </li>

            <li>
              <span>5</span>

              <div>
                <strong>
                  추적손절
                </strong>

                <p>
                  상승 시 최고가를 추적하고
                  손절가는 위로만 이동합니다.
                </p>
              </div>
            </li>

            <li>
              <span>6</span>

              <div>
                <strong>
                  매도 후 평가
                </strong>

                <p>
                  매도 후 1·5·20거래일 주가를
                  저장해 손절 적절성을
                  평가합니다.
                </p>
              </div>
            </li>

            <li>
              <span>7</span>

              <div>
                <strong>
                  모델 검증
                </strong>

                <p>
                  충분한 거래 데이터로 후보
                  모델을 평가합니다.
                </p>
              </div>
            </li>

            <li>
              <span>8</span>

              <div>
                <strong>
                  승인 모델만 적용
                </strong>

                <p>
                  검증을 통과한 모델만 실제
                  매매에 사용할 수 있습니다.
                </p>
              </div>
            </li>
          </ol>
        </section>
      </section>
    </main>
  );
}