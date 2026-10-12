import type {
  ShadowDecisionLabel,
  ShadowEvaluationStatus,
  ShadowSignalDashboard,
} from "@/lib/trading/get-shadow-signal-dashboard";

interface ShadowSignalPanelProps {
  data:
    | ShadowSignalDashboard
    | null;

  errorMessage?:
    | string
    | null;
}

function formatPrice(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  return `${new Intl.NumberFormat(
    "ko-KR",
  ).format(
    Math.round(value),
  )}원`;
}

function formatPercent(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  const sign =
    value > 0
      ? "+"
      : "";

  return `${sign}${(
    value * 100
  ).toFixed(2)}%`;
}

function formatScore(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  return value.toFixed(3);
}

function formatKoreaDateTime(
  value: string | null,
): string {
  if (!value) {
    return "-";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone:
          "Asia/Seoul",

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

function getDecisionLabel(
  value: ShadowDecisionLabel,
): string {
  switch (value) {
    case "GOOD_SKIP":
      return "정확히 거름";

    case "BAD_SKIP":
      return "상승 종목 놓침";

    case "GOOD_ENTRY":
      return "좋은 진입";

    case "BAD_ENTRY":
      return "나쁜 진입";

    default:
      return "평가 대기";
  }
}

function getDecisionClass(
  value: ShadowDecisionLabel,
): string {
  switch (value) {
    case "GOOD_SKIP":
    case "GOOD_ENTRY":
      return "good";

    case "BAD_SKIP":
    case "BAD_ENTRY":
      return "bad";

    default:
      return "pending";
  }
}

function getEvaluationLabel(
  value: ShadowEvaluationStatus,
): string {
  switch (value) {
    case "COMPLETE":
      return "평가 완료";

    case "PARTIAL":
      return "평가 중";

    case "EXPIRED":
      return "기간 만료";

    case "INVALID":
      return "평가 제외";

    default:
      return "대기";
  }
}

function getDirectionClass(
  value: number | null,
): string {
  if (
    value === null ||
    value === 0
  ) {
    return "flat";
  }

  return value > 0
    ? "up"
    : "down";
}

export default function ShadowSignalPanel({
  data,
  errorMessage = null,
}: ShadowSignalPanelProps) {
  return (
    <section
      className="panel"
      id="shadow-signals"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            SHADOW TRACKING
          </p>

          <h2>
            미매수 신호 사후평가
          </h2>

          <p className="subcopy">
            매수하지 않은 종목까지
            추적해 진입 판단이 정확했는지
            평가합니다.
          </p>
        </div>

        <span className="statusPill">
          {errorMessage
            ? "조회 오류"
            : `${data?.summary.totalTracks ?? 0} signals`}
        </span>
      </div>

      {errorMessage ? (
        <div className="emptyState">
          <h3>
            그림자 추적 결과를
            불러오지 못했습니다.
          </h3>

          <p>
            {errorMessage}
          </p>
        </div>
      ) : !data ? (
        <div className="emptyState">
          <p>
            그림자 추적 데이터가
            없습니다.
          </p>
        </div>
      ) : (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>
                전체 추적 신호
              </span>

              <strong>
                {
                  data.summary
                    .totalTracks
                }
                건
              </strong>

              <small>
                완료{" "}
                {
                  data.summary
                    .completed
                }
                건
              </small>
            </article>

            <article className="metricCard">
              <span>
                미매수 판단 정확도
              </span>

              <strong>
                {formatPercent(
                  data.summary
                    .skipAccuracy,
                )}
              </strong>

              <small>
                정확히 거름{" "}
                {
                  data.summary
                    .goodSkip
                }
                건
              </small>
            </article>

            <article className="metricCard">
              <span>
                상승 종목 놓침
              </span>

              <strong
                className={
                  data.summary
                    .badSkip > 0
                    ? "direction down"
                    : "direction flat"
                }
              >
                {
                  data.summary
                    .badSkip
                }
                건
              </strong>

              <small>
                평균 장 마감{" "}
                {formatPercent(
                  data.summary
                    .badSkipAverageReturn,
                )}
              </small>
            </article>

            <article className="metricCard">
              <span>
                정확히 거른 종목
              </span>

              <strong className="direction up">
                {
                  data.summary
                    .goodSkip
                }
                건
              </strong>

              <small>
                평균 장 마감{" "}
                {formatPercent(
                  data.summary
                    .goodSkipAverageReturn,
                )}
              </small>
            </article>

            <article className="metricCard">
              <span>
                평균 최대 상승폭
              </span>

              <strong
                className={`direction ${getDirectionClass(
                  data.summary
                    .averageMaximumReturn,
                )}`}
              >
                {formatPercent(
                  data.summary
                    .averageMaximumReturn,
                )}
              </strong>

              <small>
                평가 완료 신호 기준
              </small>
            </article>

            <article className="metricCard">
              <span>
                평균 최대 하락폭
              </span>

              <strong
                className={`direction ${getDirectionClass(
                  data.summary
                    .averageMinimumReturn,
                )}`}
              >
                {formatPercent(
                  data.summary
                    .averageMinimumReturn,
                )}
              </strong>

              <small>
                평가 완료 신호 기준
              </small>
            </article>
          </div>

          {data.rows.length === 0 ? (
            <div className="emptyState">
              <h3>
                등록된 그림자 신호가
                없습니다.
              </h3>

              <p>
                자동 운영 사이클에서
                신호가 생성되면 자동으로
                등록됩니다.
              </p>
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>신호 시각</th>
                    <th>종목</th>
                    <th>점수</th>
                    <th>기준가격</th>
                    <th>30분</th>
                    <th>60분</th>
                    <th>장 마감</th>
                    <th>최대/최소</th>
                    <th>판단 결과</th>
                    <th>평가 상태</th>
                  </tr>
                </thead>

                <tbody>
                  {data.rows
                    .slice(0, 30)
                    .map(
                      (row) => (
                        <tr
                          key={row.id}
                        >
                          <td>
                            {formatKoreaDateTime(
                              row.signalObservedAt,
                            )}
                          </td>

                          <td>
                            <strong>
                              {
                                row.stockName
                              }
                            </strong>

                            <br />

                            <small>
                              {
                                row.stockCode
                              }
                            </small>
                          </td>

                          <td>
                            {formatScore(
                              row.signalScore,
                            )}
                          </td>

                          <td>
                            {formatPrice(
                              row.referencePrice,
                            )}
                          </td>

                          <td>
                            <span
                              className={`direction ${getDirectionClass(
                                row.return30m,
                              )}`}
                            >
                              {formatPercent(
                                row.return30m,
                              )}
                            </span>
                          </td>

                          <td>
                            <span
                              className={`direction ${getDirectionClass(
                                row.return60m,
                              )}`}
                            >
                              {formatPercent(
                                row.return60m,
                              )}
                            </span>
                          </td>

                          <td>
                            <span
                              className={`direction ${getDirectionClass(
                                row.closeReturn,
                              )}`}
                            >
                              {formatPercent(
                                row.closeReturn,
                              )}
                            </span>
                          </td>

                          <td>
                            <span className="direction up">
                              {formatPercent(
                                row.maxReturn,
                              )}
                            </span>

                            <br />

                            <span className="direction down">
                              {formatPercent(
                                row.minReturn,
                              )}
                            </span>
                          </td>

                          <td>
                            <span
                              className={`shadowDecisionBadge ${getDecisionClass(
                                row.decisionLabel,
                              )}`}
                            >
                              {getDecisionLabel(
                                row.decisionLabel,
                              )}
                            </span>
                          </td>

                          <td>
                            {getEvaluationLabel(
                              row.evaluationStatus,
                            )}
                          </td>
                        </tr>
                      ),
                    )}
                </tbody>
              </table>
            </div>
          )}

          <div className="controlFooter">
            <span>
              평가 대기{" "}
              {
                data.summary
                  .pending
              }
              건 · 진행 중{" "}
              {
                data.summary
                  .partial
              }
              건
            </span>

            <span>
              최근 평가:{" "}
              {formatKoreaDateTime(
                data.summary
                  .latestEvaluatedAt,
              )}
            </span>
          </div>
        </>
      )}
    </section>
  );
}