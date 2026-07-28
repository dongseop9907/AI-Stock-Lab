import PaperResetButton from "@/app/components/PaperResetButton";
import type { PaperAccountDashboard } from "@/lib/trading/get-paper-account-dashboard";

interface PaperPortfolioPanelProps {
  data: PaperAccountDashboard | null;
  errorMessage?: string | null;
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

function formatBalance(
  value: number,
): string {
  return `${new Intl.NumberFormat(
    "ko-KR",
  ).format(Math.round(value))}원`;
}

function formatPercent(
  value: number,
): string {
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

export default function PaperPortfolioPanel({
  data,
  errorMessage = null,
}: PaperPortfolioPanelProps) {
  return (
    <section
      className="panel"
      id="paper-portfolio"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            PAPER PORTFOLIO
          </p>

          <h2>
            모의계좌 및 보유 포지션
          </h2>

          <p className="subcopy">
            위험관리 승인을 거쳐 체결된
            주문과 현재 평가손익입니다.
          </p>
        </div>

        <div className="paperPortfolioActions">
  <span className="statusPill">
    {errorMessage
      ? "조회 오류"
      : data?.account.mode ??
        "PAPER"}
  </span>

  <PaperResetButton />
</div>
      </div>

      {errorMessage ? (
        <div className="emptyState">
          <h3>
            모의계좌를 불러오지
            못했습니다.
          </h3>

          <p>{errorMessage}</p>
        </div>
      ) : !data ? (
        <div className="emptyState">
          <h3>
            모의계좌 정보가 없습니다.
          </h3>
        </div>
      ) : (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>계좌 평가금액</span>

              <strong>
                {formatBalance(
                  data.account
                    .accountEquity,
                )}
              </strong>

              <small>
                현금 + 보유주식 평가액
              </small>
            </article>

            <article className="metricCard">
              <span>주문 가능 현금</span>

              <strong>
                {formatBalance(
                  data.account
                    .cashBalance,
                )}
              </strong>

              <small>
                신규 주문 사용 가능액
              </small>
            </article>

            <article className="metricCard">
              <span>총 평가손익</span>

              <strong
                className={`direction ${getDirectionClass(
                  data.account.totalPnl,
                )}`}
              >
                {formatMoney(
                  data.account.totalPnl,
                )}
              </strong>

              <small>
                {formatPercent(
                  data.account
                    .totalReturn,
                )}
              </small>
            </article>

            <article className="metricCard">
              <span>투자 비중</span>

              <strong>
                {formatPercent(
                  data.account
                    .exposureRate,
                )}
              </strong>

              <small>
                보유 포지션{" "}
                {
                  data.account
                    .openPositionCount
                }
                개
              </small>
            </article>
          </div>

          {data.positions.length ===
          0 ? (
            <div className="emptyState">
              <h3>
                현재 보유 중인 종목이
                없습니다.
              </h3>

              <p>
                진입 신호에서 모의주문을
                생성하고 승인 주문을
                체결해 주세요.
              </p>
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>수량</th>
                    <th>평균 매수가</th>
                    <th>현재가</th>
                    <th>평가금액</th>
                    <th>평가손익</th>
                    <th>수익률</th>
                    <th>현재 손절가</th>
                    <th>최고가</th>
                    <th>트레일링</th>
                    <th>진입 모델</th>
                  </tr>
                </thead>

                <tbody>
                  {data.positions.map(
                    (position) => (
                      <tr
                        key={
                          position.id
                        }
                      >
                        <td>
                          <strong>
                            {
                              position.stockName
                            }
                          </strong>

                          <br />

                          <small>
                            {
                              position.stockCode
                            }
                            {position.sector
                              ? ` · ${position.sector}`
                              : ""}
                          </small>
                        </td>

                        <td>
                          {
                            position.quantity
                          }
                          주
                        </td>

                        <td>
                          {formatBalance(
                            position.averagePrice,
                          )}
                        </td>

                        <td>
                          {formatBalance(
                            position.currentPrice,
                          )}
                        </td>

                        <td>
                          {formatBalance(
                            position.marketValue,
                          )}
                        </td>

                        <td>
                          <span
                            className={`direction ${getDirectionClass(
                              position.unrealizedPnl,
                            )}`}
                          >
                            {formatMoney(
                              position.unrealizedPnl,
                            )}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`direction ${getDirectionClass(
                              position.unrealizedReturn,
                            )}`}
                          >
                            {formatPercent(
                              position.unrealizedReturn,
                            )}
                          </span>
                        </td>

                        <td>
                          {formatBalance(
                            position.stopPrice,
                          )}

                          <br />

                          <small>
                            현재가 대비{" "}
                            {formatPercent(
                              position.stopDistanceRate,
                            )}
                          </small>
                        </td>

                        <td>
                          {formatBalance(
                            position.highestPrice,
                          )}
                        </td>

                        <td>
                          <span
                            className={`direction ${
                              position.trailingStopActive
                                ? "up"
                                : "flat"
                            }`}
                          >
                            {position.trailingStopActive
                              ? "활성"
                              : "대기"}
                          </span>
                        </td>

                        <td>
                          {position.modelName ? (
                            <>
                              <strong>
                                {
                                  position.modelName
                                }
                              </strong>

                              <br />

                              <small>
                                {
                                  position.modelVersion
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