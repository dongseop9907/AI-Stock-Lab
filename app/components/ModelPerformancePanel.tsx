import type { ModelPerformance } from "@/lib/models/get-model-performance";

interface ModelPerformancePanelProps {
  models: ModelPerformance[];
  errorMessage?: string | null;
}

function clamp(
  value: number,
  minimum = 0,
  maximum = 1,
): number {
  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

/**
 * 대시보드 표시용 운영 성과 점수다.
 *
 * 실제 모델 승인 여부는 이 점수가 아니라
 * 모델 검증 시스템의 규칙으로 결정한다.
 */
function calculateOperatingScore(
  model: ModelPerformance,
): number | null {
  /*
   * 종료 거래 5건 미만이면 점수를 표시하지 않는다.
   */
  if (
    model.trades.closed < 5 ||
    model.trades.averageReturn === null
  ) {
    return null;
  }

  const winRateScore =
    clamp(model.trades.winRate ?? 0) * 25;

  /*
   * 평균 수익률 -3%를 0점,
   * +5%를 30점 수준으로 정규화한다.
   */
  const returnScore =
    clamp(
      (
        model.trades.averageReturn +
        0.03
      ) / 0.08,
    ) * 30;

  let profitFactorValue =
    model.trades.profitFactor;

  /*
   * 이익 거래만 있고 손실 거래가 없는 경우
   * Profit Factor가 NULL일 수 있다.
   */
  if (
    profitFactorValue === null &&
    model.trades.winning > 0 &&
    model.trades.losing === 0
  ) {
    profitFactorValue = 2;
  }

  const profitFactorScore =
    clamp(
      (
        (profitFactorValue ?? 0) -
        0.8
      ) / 1.2,
    ) * 20;

  const stopQualityScore =
    model.exitQuality.averageScore === null
      ? 7.5
      : clamp(
          (
            model.exitQuality.averageScore +
            1
          ) / 2,
        ) * 15;

  const sampleScore =
    clamp(
      model.trades.closed / 30,
    ) * 10;

  return Math.round(
    winRateScore +
    returnScore +
    profitFactorScore +
    stopQualityScore +
    sampleScore,
  );
}

function formatMoney(value: number): string {
  const formatted = new Intl.NumberFormat(
    "ko-KR",
  ).format(Math.round(Math.abs(value)));

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

  const sign = value > 0 ? "+" : "";

  return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatRatio(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  return value.toFixed(2);
}

function formatQualityScore(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  return value.toFixed(3);
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

function getStatusClass(
  status: string,
): "up" | "down" | "flat" {
  if (status === "APPROVED") {
    return "up";
  }

  if (
    status === "REJECTED" ||
    status === "RETIRED"
  ) {
    return "down";
  }

  return "flat";
}

export default function ModelPerformancePanel({
  models,
  errorMessage = null,
}: ModelPerformancePanelProps) {
  const rankedModels = [...models].sort(
    (left, right) => {
      const leftScore =
        calculateOperatingScore(left);

      const rightScore =
        calculateOperatingScore(right);

      if (
        leftScore === null &&
        rightScore === null
      ) {
        return (
          right.trades.closed -
          left.trades.closed
        );
      }

      if (leftScore === null) {
        return 1;
      }

      if (rightScore === null) {
        return -1;
      }

      return rightScore - leftScore;
    },
  );

  const totalOrders = models.reduce(
    (sum, model) =>
      sum + model.orders.requested,
    0,
  );

  const totalFilledOrders = models.reduce(
    (sum, model) =>
      sum + model.orders.filled,
    0,
  );

  const totalClosedTrades = models.reduce(
    (sum, model) =>
      sum + model.trades.closed,
    0,
  );

  const totalRealizedPnl = models.reduce(
    (sum, model) =>
      sum +
      model.trades.totalRealizedPnl,
    0,
  );

  return (
    <section
      className="panel"
      id="model-performance"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            MODEL PERFORMANCE
          </p>

          <h2>모델별 운영 성과</h2>

          <p className="subcopy">
            모델별 주문, 체결, 거래 수익과
            손절 품질을 비교합니다.
          </p>
        </div>

        <span className="statusPill">
          {errorMessage
            ? "조회 오류"
            : `${models.length} models`}
        </span>
      </div>

      {errorMessage ? (
        <div className="emptyState">
          <h3>
            모델 성과를 불러오지 못했습니다.
          </h3>

          <p>{errorMessage}</p>
        </div>
      ) : models.length === 0 ? (
        <div className="emptyState">
          <h3>등록된 모델이 없습니다.</h3>

          <p>
            후보 모델을 등록하고 주문에
            modelId를 연결해 주세요.
          </p>
        </div>
      ) : (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>전체 주문</span>
              <strong>{totalOrders}</strong>
              <small>모델 지정 매수 주문</small>
            </article>

            <article className="metricCard">
              <span>체결 주문</span>
              <strong>{totalFilledOrders}</strong>
              <small>위험검증 후 체결</small>
            </article>

            <article className="metricCard">
              <span>종료 거래</span>
              <strong>{totalClosedTrades}</strong>
              <small>수익률 계산 완료</small>
            </article>

            <article className="metricCard">
              <span>총 실현손익</span>

              <strong>
                {formatMoney(
                  totalRealizedPnl,
                )}
              </strong>

              <small>
                모든 모델 합산
              </small>
            </article>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>모델</th>
                  <th>운영 점수</th>
                  <th>주문/체결</th>
                  <th>위험승인률</th>
                  <th>종료 거래</th>
                  <th>승률</th>
                  <th>총 실현손익</th>
                  <th>평균 수익률</th>
                  <th>Profit Factor</th>
                  <th>손절 품질</th>
                  <th>손절 평가</th>
                </tr>
              </thead>

              <tbody>
                {rankedModels.map(
                  (model) => {
                    const operatingScore =
                      calculateOperatingScore(
                        model,
                      );

                    const pnlClass =
                      getDirectionClass(
                        model.trades
                          .totalRealizedPnl,
                      );

                    const returnClass =
                      getDirectionClass(
                        model.trades
                          .averageReturn ?? 0,
                      );

                    return (
                      <tr key={model.modelId}>
                        <td>
                          <strong>
                            {model.modelName}
                          </strong>

                          <br />

                          <small>
                            {model.modelVersion}
                            {" · "}
                            {model.purpose}
                          </small>

                          <br />

                          <span
                            className={`direction ${getStatusClass(
                              model.status,
                            )}`}
                          >
                            {model.status}
                          </span>
                        </td>

                        <td>
                          {operatingScore ===
                          null ? (
                            <>
                              <strong>-</strong>
                              <br />
                              <small>
                                데이터 부족
                              </small>
                            </>
                          ) : (
                            <>
                              <strong>
                                {operatingScore}
                              </strong>
                              <small>
                                {" "}
                                / 100
                              </small>
                            </>
                          )}
                        </td>

                        <td>
                          <strong>
                            {
                              model.orders
                                .requested
                            }
                          </strong>

                          {" / "}

                          <strong>
                            {
                              model.orders
                                .filled
                            }
                          </strong>

                          <br />

                          <small>
                            요청 / 체결
                          </small>
                        </td>

                        <td>
                          {formatPercent(
                            model.orders
                              .approvalRate,
                          )}
                        </td>

                        <td>
                          <strong>
                            {
                              model.trades
                                .closed
                            }
                          </strong>

                          <br />

                          <small>
                            승{" "}
                            {
                              model.trades
                                .winning
                            }
                            {" · "}
                            패{" "}
                            {
                              model.trades
                                .losing
                            }
                          </small>
                        </td>

                        <td>
                          {formatPercent(
                            model.trades
                              .winRate,
                          )}
                        </td>

                        <td>
                          <span
                            className={`direction ${pnlClass}`}
                          >
                            {formatMoney(
                              model.trades
                                .totalRealizedPnl,
                            )}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`direction ${returnClass}`}
                          >
                            {formatPercent(
                              model.trades
                                .averageReturn,
                            )}
                          </span>
                        </td>

                        <td>
                          {formatRatio(
                            model.trades
                              .profitFactor,
                          )}
                        </td>

                        <td>
                          {formatQualityScore(
                            model.exitQuality
                              .averageScore,
                          )}
                        </td>

                        <td>
                          <small>
                            방어{" "}
                            {
                              model.exitQuality
                                .protectedCapital
                            }
                            {" · "}
                            조기{" "}
                            {
                              model.exitQuality
                                .earlyExit
                            }
                            <br />
                            혼합{" "}
                            {
                              model.exitQuality
                                .mixed
                            }
                            {" · "}
                            중립{" "}
                            {
                              model.exitQuality
                                .neutral
                            }
                          </small>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>

          <div className="emptyState">
            <p>
              운영 점수는 종료 거래가 5건
              이상인 모델만 계산합니다.
              실제투자 승인은 모델 검증 시스템의
              결과를 따릅니다.
            </p>
          </div>
        </>
      )}
    </section>
  );
}