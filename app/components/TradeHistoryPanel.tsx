import type { TradeHistoryDashboard } from "@/lib/trading/get-trade-history-dashboard";

interface TradeHistoryPanelProps {
  data: TradeHistoryDashboard | null;
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
  const formatted =
    new Intl.NumberFormat(
      "ko-KR",
    ).format(
      Math.round(
        Math.abs(value),
      ),
    );

  if (value > 0) {
    return `+${formatted}원`;
  }

  if (value < 0) {
    return `-${formatted}원`;
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

/*
 * 서버·브라우저 로케일 차이를 피하기 위해
 * AM/PM 없이 고정 형식으로 만든다.
 */
function formatDateTime(
  value: string,
): string {
  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "-";
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      },
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  return `${values.year}.${values.month}.${values.day} ${values.hour}:${values.minute}`;
}

function formatHoldingTime(
  minutes: number,
): string {
  if (minutes < 60) {
    return `${minutes}분`;
  }

  const hours =
    Math.floor(minutes / 60);

  const remainingMinutes =
    minutes % 60;

  if (hours < 24) {
    return `${hours}시간 ${remainingMinutes}분`;
  }

  const days =
    Math.floor(hours / 24);

  const remainingHours =
    hours % 24;

  return `${days}일 ${remainingHours}시간`;
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

function getExitReasonLabel(
  reason: string,
): string {
  switch (reason) {
    case "STOP_LOSS":
      return "초기 손절";

    case "TRAILING_STOP":
      return "추적 손절";

    case "MODEL_EXIT":
      return "모델 매도";

    case "MANUAL":
      return "수동 매도";

    default:
      return reason;
  }
}

function getVerdictLabel(
  verdict: string | null,
): string {
  switch (verdict) {
    case "PROTECTED_CAPITAL":
      return "자본 보호";

    case "EARLY_EXIT":
      return "조기 매도";

    case "MIXED":
      return "혼합 결과";

    case "NEUTRAL":
      return "중립";

    case "PENDING":
      return "평가 대기";

    default:
      return "미평가";
  }
}

function getVerdictClass(
  verdict: string | null,
): "up" | "down" | "flat" {
  if (
    verdict ===
    "PROTECTED_CAPITAL"
  ) {
    return "up";
  }

  if (
    verdict ===
    "EARLY_EXIT"
  ) {
    return "down";
  }

  return "flat";
}

export default function TradeHistoryPanel({
  data,
  errorMessage = null,
}: TradeHistoryPanelProps) {
  return (
    <section
      className="panel"
      id="trade-history"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            TRADE HISTORY
          </p>

          <h2>
            종료 거래 및 손절 평가
          </h2>

          <p className="subcopy">
            종료된 모의거래의 실현손익과
            매도 후 가격 변화를 확인합니다.
          </p>
        </div>

        <span className="statusPill">
          {errorMessage
            ? "조회 오류"
            : `${data?.summary.closedTrades ?? 0} trades`}
        </span>
      </div>

      {errorMessage ? (
        <div className="emptyState">
          <h3>
            거래 이력을 불러오지
            못했습니다.
          </h3>

          <p>{errorMessage}</p>
        </div>
      ) : !data ? (
        <div className="emptyState">
          <h3>
            거래 이력 정보가 없습니다.
          </h3>
        </div>
      ) : (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>종료 거래</span>

              <strong>
                {data.summary.closedTrades}
              </strong>

              <small>
                승 {data.summary.winningTrades}
                {" · "}
                패 {data.summary.losingTrades}
              </small>
            </article>

            <article className="metricCard">
              <span>승률</span>

              <strong>
                {formatPercent(
                  data.summary.winRate,
                )}
              </strong>

              <small>
                전체 종료 거래 기준
              </small>
            </article>

            <article className="metricCard">
              <span>총 실현손익</span>

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
                평균 수익률{" "}
                {formatPercent(
                  data.summary
                    .averageReturn,
                )}
              </small>
            </article>

            <article className="metricCard">
              <span>손절 평가</span>

              <strong>
                {
                  data.summary
                    .protectedCapitalCount
                }
              </strong>

              <small>
                자본 보호{" "}
                {
                  data.summary
                    .protectedCapitalCount
                }
                건 · 조기 매도{" "}
                {
                  data.summary
                    .earlyExitCount
                }
                건
              </small>
            </article>
          </div>

          {data.trades.length === 0 ? (
            <div className="emptyState">
              <h3>
                종료된 거래가 없습니다.
              </h3>

              <p>
                손절 또는 추적손절이
                실행되면 거래 결과가 여기에
                표시됩니다.
              </p>
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>매도 시각</th>
                    <th>보유 시간</th>
                    <th>수량</th>
                    <th>진입가</th>
                    <th>매도가</th>
                    <th>실현손익</th>
                    <th>수익률</th>
                    <th>매도 이유</th>
                    <th>5일 후</th>
                    <th>20일 후</th>
                    <th>손절 평가</th>
                    <th>모델</th>
                  </tr>
                </thead>

                <tbody>
                  {data.trades.map(
                    (trade) => (
                      <tr key={trade.id}>
                        <td>
                          <strong>
                            {
                              trade.stockName
                            }
                          </strong>

                          <br />

                          <small>
                            {
                              trade.stockCode
                            }
                          </small>
                        </td>

                        <td>
                          {formatDateTime(
                            trade.closedAt,
                          )}
                        </td>

                        <td>
                          {formatHoldingTime(
                            trade.holdingMinutes,
                          )}
                        </td>

                        <td>
                          {trade.quantity}주
                        </td>

                        <td>
                          {formatBalance(
                            trade.entryPrice,
                          )}
                        </td>

                        <td>
                          {formatBalance(
                            trade.exitPrice,
                          )}
                        </td>

                        <td>
                          <span
                            className={`direction ${getDirectionClass(
                              trade.realizedPnl,
                            )}`}
                          >
                            {formatMoney(
                              trade.realizedPnl,
                            )}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`direction ${getDirectionClass(
                              trade.realizedReturn,
                            )}`}
                          >
                            {formatPercent(
                              trade.realizedReturn,
                            )}
                          </span>
                        </td>

                        <td>
                          {getExitReasonLabel(
                            trade.exitReason,
                          )}
                        </td>

                        <td>
                          {formatPercent(
                            trade.postExit
                              .return5d,
                          )}
                        </td>

                        <td>
                          {formatPercent(
                            trade.postExit
                              .return20d,
                          )}
                        </td>

                        <td>
                          <span
                            className={`direction ${getVerdictClass(
                              trade.evaluation
                                .verdict,
                            )}`}
                          >
                            {getVerdictLabel(
                              trade.evaluation
                                .verdict,
                            )}
                          </span>

                          <br />

                          <small>
                            품질{" "}
                            {trade.evaluation
                              .qualityScore ===
                            null
                              ? "-"
                              : trade.evaluation
                                  .qualityScore
                                  .toFixed(3)}
                          </small>
                        </td>

                        <td>
                          {trade.modelName ? (
                            <>
                              <strong>
                                {
                                  trade.modelName
                                }
                              </strong>

                              <br />

                              <small>
                                {
                                  trade.modelVersion
                                }
                              </small>
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}