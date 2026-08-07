import type {
  DailyAlertLevel,
  DailyPerformanceDashboard,
  DailyPerformanceRow,
} from "@/lib/trading/get-daily-performance-dashboard";

interface DailyPerformancePanelProps {
  data: DailyPerformanceDashboard | null;
  errorMessage?: string | null;
}

function formatBalance(
  value: number,
): string {
  return `${new Intl.NumberFormat(
    "ko-KR",
  ).format(Math.round(value))}원`;
}

function formatMoney(
  value: number,
): string {
  const absolute =
    new Intl.NumberFormat(
      "ko-KR",
    ).format(
      Math.round(
        Math.abs(value),
      ),
    );

  if (value > 0) {
    return `+${absolute}원`;
  }

  if (value < 0) {
    return `-${absolute}원`;
  }

  return "0원";
}

function formatPercent(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  const sign =
    value > 0 ? "+" : "";

  return `${sign}${(
    value * 100
  ).toFixed(2)}%`;
}

function getDirectionClass(
  value: number,
): "up" | "down" | "flat" {
  if (value > 0) {
    return "up";
  }

  if (value < 0) {
    return "down";
  }

  return "flat";
}

function getAlertLabel(
  level: DailyAlertLevel,
): string {
  switch (level) {
    case "CRITICAL":
      return "심각";

    case "WARNING":
      return "주의";

    default:
      return "정상";
  }
}

function getAlertClass(
  level: DailyAlertLevel,
): "up" | "down" | "flat" {
  if (level === "CRITICAL") {
    return "down";
  }

  if (level === "WARNING") {
    return "flat";
  }

  return "up";
}

function createChart(
  reports: DailyPerformanceRow[],
) {
  const visible =
    reports.slice(-30);

  const width = 900;
  const height = 260;

  const paddingX = 42;
  const paddingY = 28;

  if (visible.length === 0) {
    return {
      visible,
      width,
      height,
      points: "",
      minimum: 0,
      maximum: 0,
    };
  }

  const equities =
    visible.map(
      (report) =>
        report.accountEquity,
    );

  const rawMinimum =
    Math.min(...equities);

  const rawMaximum =
    Math.max(...equities);

  const range =
    rawMaximum -
    rawMinimum;

  const chartPadding =
    range > 0
      ? range * 0.1
      : Math.max(
          rawMaximum * 0.01,
          1000,
        );

  const minimum =
    rawMinimum -
    chartPadding;

  const maximum =
    rawMaximum +
    chartPadding;

  const chartWidth =
    width -
    paddingX * 2;

  const chartHeight =
    height -
    paddingY * 2;

  const points =
    visible
      .map((report, index) => {
        const x =
          visible.length === 1
            ? width / 2
            : paddingX +
              (
                index /
                (
                  visible.length -
                  1
                )
              ) *
                chartWidth;

        const ratio =
          maximum === minimum
            ? 0.5
            : (
                report.accountEquity -
                minimum
              ) /
              (
                maximum -
                minimum
              );

        const y =
          paddingY +
          (
            1 -
            ratio
          ) *
            chartHeight;

        return `${x.toFixed(
          2,
        )},${y.toFixed(2)}`;
      })
      .join(" ");

  return {
    visible,
    width,
    height,
    points,
    minimum,
    maximum,
  };
}

export default function DailyPerformancePanel({
  data,
  errorMessage = null,
}: DailyPerformancePanelProps) {
  const chart =
    createChart(
      data?.reports ?? [],
    );

  const firstDate =
    chart.visible[0]
      ?.reportDate ?? "-";

  const lastDate =
    chart.visible.at(-1)
      ?.reportDate ?? "-";

  return (
    <section
      className="panel"
      id="daily-performance"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            DAILY PERFORMANCE
          </p>

          <h2>
            일일 성과 및 누적수익률
          </h2>

          <p className="subcopy">
            장 마감 계좌 평가금액과
            일별 손익, 자동 운영 상태를
            확인합니다.
          </p>
        </div>

        <span className="statusPill">
          {errorMessage
            ? "조회 오류"
            : `${data?.reports.length ?? 0} days`}
        </span>
      </div>

      {errorMessage ? (
        <div className="emptyState">
          <h3>
            일일 성과를 불러오지
            못했습니다.
          </h3>

          <p>{errorMessage}</p>
        </div>
      ) : !data ? (
        <div className="emptyState">
          <h3>
            일일 성과 정보가 없습니다.
          </h3>
        </div>
      ) : (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>계좌 평가금액</span>

              <strong>
                {formatBalance(
                  data.summary
                    .accountEquity,
                )}
              </strong>

              <small>
                기준일{" "}
                {data.summary
                  .latestReportDate ??
                  "-"}
              </small>
            </article>

            <article className="metricCard">
              <span>전일 대비</span>

              <strong
                className={`direction ${getDirectionClass(
                  data.summary
                    .dailyEquityChange,
                )}`}
              >
                {formatMoney(
                  data.summary
                    .dailyEquityChange,
                )}
              </strong>

              <small>
                {formatPercent(
                  data.summary
                    .dailyEquityReturn,
                )}
              </small>
            </article>

            <article className="metricCard">
              <span>누적수익률</span>

              <strong
                className={`direction ${getDirectionClass(
                  data.summary
                    .cumulativeReturn,
                )}`}
              >
                {formatPercent(
                  data.summary
                    .cumulativeReturn,
                )}
              </strong>

              <small>
                초기자금{" "}
                {formatBalance(
                  data.initialBalance,
                )}
              </small>
            </article>

            <article className="metricCard">
              <span>최대 낙폭</span>

              <strong
                className={`direction ${getDirectionClass(
                  data.summary
                    .maxDrawdown,
                )}`}
              >
                {formatPercent(
                  data.summary
                    .maxDrawdown,
                )}
              </strong>

              <small>
                고점 대비 계좌 하락폭
              </small>
            </article>

            <article className="metricCard">
              <span>누적 실현손익</span>

              <strong
                className={`direction ${getDirectionClass(
                  data.summary
                    .totalRealizedPnl,
                )}`}
              >
                {formatMoney(
                  data.summary
                    .totalRealizedPnl,
                )}
              </strong>

              <small>
                종료 거래{" "}
                {
                  data.summary
                    .totalClosedTrades
                }
                건
              </small>
            </article>

            <article className="metricCard">
              <span>누적 승률</span>

              <strong>
                {formatPercent(
                  data.summary
                    .overallWinRate,
                )}
              </strong>

              <small>
                승{" "}
                {
                  data.summary
                    .totalWinningTrades
                }
                건 · 패{" "}
                {
                  data.summary
                    .totalLosingTrades
                }
                건
              </small>
            </article>

            <article className="metricCard">
              <span>자동 운영 실패</span>

              <strong
                className={`direction ${
                  data.summary
                    .automationFailures > 0
                    ? "down"
                    : "up"
                }`}
              >
                {
                  data.summary
                    .automationFailures
                }
                건
              </strong>

              <small>
                총 실행{" "}
                {
                  data.summary
                    .automationRuns
                }
                건
              </small>
            </article>

            <article className="metricCard">
              <span>현재 상태</span>

              <strong
                className={`direction ${getAlertClass(
                  data.summary
                    .alertLevel,
                )}`}
              >
                {getAlertLabel(
                  data.summary
                    .alertLevel,
                )}
              </strong>

              <small>
                최신 일일보고서 기준
              </small>
            </article>
          </div>

          {data.reports.length === 0 ? (
            <div className="emptyState">
              <h3>
                생성된 일일 보고서가
                없습니다.
              </h3>

              <p>
                일일 보고서 API를 먼저
                실행해 주세요.
              </p>
            </div>
          ) : (
            <>
              <div className="performanceChart">
                <div className="chartHeader">
                  <div>
                    <strong>
                      최근 계좌 평가금액
                    </strong>

                    <small>
                      최근 최대 30일
                    </small>
                  </div>

                  <span>
                    {firstDate}
                    {" ~ "}
                    {lastDate}
                  </span>
                </div>

                <svg
                  viewBox={`0 0 ${chart.width} ${chart.height}`}
                  role="img"
                  aria-label="일별 계좌 평가금액 그래프"
                >
                  <line
                    x1="42"
                    y1="28"
                    x2="42"
                    y2="232"
                    className="chartAxis"
                  />

                  <line
                    x1="42"
                    y1="232"
                    x2="858"
                    y2="232"
                    className="chartAxis"
                  />

                  <polyline
                    points={
                      chart.points
                    }
                    className="equityLine"
                  />
                </svg>

                <div className="chartRange">
                  <span>
                    최저{" "}
                    {formatBalance(
                      chart.minimum,
                    )}
                  </span>

                  <span>
                    최고{" "}
                    {formatBalance(
                      chart.maximum,
                    )}
                  </span>
                </div>
              </div>

              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>기준일</th>
                      <th>계좌 평가액</th>
                      <th>누적수익률</th>
                      <th>실현손익</th>
                      <th>종료 거래</th>
                      <th>승률</th>
                      <th>포지션</th>
                      <th>자동 운영</th>
                      <th>경고</th>
                    </tr>
                  </thead>

                  <tbody>
                    {[...data.reports]
                      .reverse()
                      .slice(0, 30)
                      .map(
                        (report) => (
                          <tr
                            key={
                              report.id
                            }
                          >
                            <td>
                              {
                                report.reportDate
                              }
                            </td>

                            <td>
                              {formatBalance(
                                report.accountEquity,
                              )}
                            </td>

                            <td>
                              <span
                                className={`direction ${getDirectionClass(
                                  report.cumulativeReturn,
                                )}`}
                              >
                                {formatPercent(
                                  report.cumulativeReturn,
                                )}
                              </span>
                            </td>

                            <td>
                              <span
                                className={`direction ${getDirectionClass(
                                  report.realizedPnlDay,
                                )}`}
                              >
                                {formatMoney(
                                  report.realizedPnlDay,
                                )}
                              </span>
                            </td>

                            <td>
                              {
                                report.closedTrades
                              }
                              건
                            </td>

                            <td>
                              {formatPercent(
                                report.winRate,
                              )}
                            </td>

                            <td>
                              {
                                report.openPositionCount
                              }
                              개
                            </td>

                            <td>
                              성공{" "}
                              {
                                report.automationSuccesses
                              }
                              건
                              <br />
                              <small>
                                실패{" "}
                                {
                                  report.automationFailures
                                }
                                건
                              </small>
                            </td>

                            <td>
                              <span
                                className={`direction ${getAlertClass(
                                  report.alertLevel,
                                )}`}
                              >
                                {getAlertLabel(
                                  report.alertLevel,
                                )}
                              </span>

                              <br />

                              <small>
                                {report
                                  .alertMessages[0] ??
                                  "-"}
                              </small>
                            </td>
                          </tr>
                        ),
                      )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}