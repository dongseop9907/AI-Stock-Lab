"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  StockPredictionDashboard,
  StockPredictionDirection,
} from "@/lib/trading/get-stock-prediction-dashboard";

interface StockPredictionPanelProps {
  data:
    | StockPredictionDashboard
    | null;

  errorMessage?:
    | string
    | null;
}

interface GeneratePayload {
  ok: boolean;

  message?: string;

  result?: {
    analyzed?: number;
    saved?: number;
    candidateCount?: number;
  };
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

  return `${(
    value * 100
  ).toFixed(1)}점`;
}

function formatConfidence(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  return `${(
    value * 100
  ).toFixed(1)}%`;
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

function formatVolumeRatio(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  return `${value.toFixed(2)}배`;
}

function formatDateTime(
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

function getDirectionLabel(
  direction:
    StockPredictionDirection,
): string {
  switch (direction) {
    case "UP":
      return "상승";

    case "DOWN":
      return "하락";

    default:
      return "중립";
  }
}

function getDirectionClass(
  direction:
    StockPredictionDirection,
): string {
  switch (direction) {
    case "UP":
      return "up";

    case "DOWN":
      return "down";

    default:
      return "neutral";
  }
}

function getNumberDirectionClass(
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

export default function StockPredictionPanel({
  data,
  errorMessage = null,
}: StockPredictionPanelProps) {
  const router =
    useRouter();

  const [
    isGenerating,
    setIsGenerating,
  ] =
    useState(false);

  const [
    actionMessage,
    setActionMessage,
  ] =
    useState<string | null>(
      null,
    );

  const [
    actionError,
    setActionError,
  ] =
    useState<string | null>(
      null,
    );

  async function generatePredictions() {
    try {
      setIsGenerating(true);
      setActionMessage(null);
      setActionError(null);

      const response =
        await fetch(
          "/api/predictions/generate",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json; charset=utf-8",
            },

            body: JSON.stringify({
              disclosureLookbackDays:
                14,

              candidateThreshold:
                data
                  ?.candidateThreshold ??
                0.62,
            }),
          },
        );

      const responseText =
        await response.text();

      let payload:
        GeneratePayload;

      try {
        payload =
          JSON.parse(
            responseText,
          ) as GeneratePayload;
      } catch {
        throw new Error(
          response.status === 404
            ? "AI 예측 생성 API를 찾을 수 없습니다. 서버 빌드를 확인해 주세요."
            : `서버가 JSON이 아닌 응답을 반환했습니다. HTTP ${response.status}`,
        );
      }

      if (
        !response.ok ||
        !payload.ok
      ) {
        throw new Error(
          payload.message ??
            "AI 예측 생성에 실패했습니다.",
        );
      }

      const saved =
        payload.result?.saved ??
        0;

      const candidateCount =
        payload.result
          ?.candidateCount ??
        0;

      setActionMessage(
        `예측 ${saved}건을 갱신했습니다. 상승 후보는 ${candidateCount}건입니다.`,
      );

      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "AI 예측 생성 중 오류가 발생했습니다.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
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

          <p className="subcopy">
            가격 흐름과 거래량,
            OpenDART 공시 중요도를
            결합해 상승 후보를
            계산합니다.
          </p>
        </div>

        <button
          type="button"
          className="controlButton primary"
          disabled={isGenerating}
          onClick={() =>
            void generatePredictions()
          }
        >
          {isGenerating
            ? "예측 생성 중..."
            : "예측 다시 생성"}
        </button>
      </div>

      {errorMessage ? (
        <div className="emptyState">
          <h3>
            AI 예측 결과를
            불러오지 못했습니다.
          </h3>

          <p>
            {errorMessage}
          </p>
        </div>
      ) : !data ? (
        <div className="emptyState">
          <h3>
            생성된 예측이 없습니다.
          </h3>

          <p>
            예측 다시 생성 버튼을 눌러
            첫 예측 결과를 만드세요.
          </p>
        </div>
      ) : (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>
                분석 종목
              </span>

              <strong>
                {data.summary.total}
                개
              </strong>

              <small>
                활성 종목 기준
              </small>
            </article>

            <article className="metricCard">
              <span>
                상승 후보
              </span>

              <strong className="direction up">
                {
                  data.summary
                    .candidateCount
                }
                개
              </strong>

              <small>
                기준{" "}
                {formatScore(
                  data
                    .candidateThreshold,
                )}
              </small>
            </article>

            <article className="metricCard">
              <span>
                평균 예측점수
              </span>

              <strong>
                {formatScore(
                  data.summary
                    .averageScore,
                )}
              </strong>

              <small>
                전체 분석 종목
              </small>
            </article>

            <article className="metricCard">
              <span>
                평균 신뢰도
              </span>

              <strong>
                {formatConfidence(
                  data.summary
                    .averageConfidence,
                )}
              </strong>

              <small>
                데이터 완성도 포함
              </small>
            </article>

            <article className="metricCard">
              <span>
                긍정 공시
              </span>

              <strong className="direction up">
                {
                  data.summary
                    .positiveDisclosureCount
                }
                건
              </strong>

              <small>
                최근 14일 분석
              </small>
            </article>

            <article className="metricCard">
              <span>
                부정 공시
              </span>

              <strong className="direction down">
                {
                  data.summary
                    .negativeDisclosureCount
                }
                건
              </strong>

              <small>
                최근 14일 분석
              </small>
            </article>
          </div>

          <div className="predictionSummary">
            <span>
              상승{" "}
              {data.summary.upCount}개
            </span>

            <span>
              중립{" "}
              {
                data.summary
                  .neutralCount
              }
              개
            </span>

            <span>
              하락{" "}
              {
                data.summary
                  .downCount
              }
              개
            </span>

            <span>
              모델{" "}
              {data.modelName} ·{" "}
              {data.modelVersion}
            </span>

            <span>
              생성{" "}
              {formatDateTime(
                data.generatedAt,
              )}
            </span>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>순위</th>
                  <th>종목</th>
                  <th>예측점수</th>
                  <th>방향</th>
                  <th>신뢰도</th>
                  <th>현재가</th>
                  <th>가격 모멘텀</th>
                  <th>장중 등락</th>
                  <th>거래량</th>
                  <th>공시 영향</th>
                  <th>후보</th>
                  <th>판단 이유</th>
                </tr>
              </thead>

              <tbody>
                {data.rows.map(
                  (row, index) => (
                    <tr key={row.id}>
                      <td>
                        {index + 1}
                      </td>

                      <td>
                        <strong>
                          {row.stockName}
                        </strong>

                        <br />

                        <small>
                          {row.stockCode}

                          {row.sector
                            ? ` · ${row.sector}`
                            : ""}
                        </small>
                      </td>

                      <td>
                        <strong>
                          {formatScore(
                            row.score,
                          )}
                        </strong>
                      </td>

                      <td>
                        <span
                          className={`predictionDirectionBadge ${getDirectionClass(
                            row.direction,
                          )}`}
                        >
                          {getDirectionLabel(
                            row.direction,
                          )}
                        </span>
                      </td>

                      <td>
                        {formatConfidence(
                          row.confidence,
                        )}
                      </td>

                      <td>
                        {formatPrice(
                          row.latestPrice,
                        )}
                      </td>

                      <td>
                        <span
                          className={`direction ${getNumberDirectionClass(
                            row.priceMomentum,
                          )}`}
                        >
                          {formatPercent(
                            row.priceMomentum,
                          )}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`direction ${getNumberDirectionClass(
                            row.intradayReturn,
                          )}`}
                        >
                          {formatPercent(
                            row.intradayReturn,
                          )}
                        </span>
                      </td>

                      <td>
                        {formatVolumeRatio(
                          row.volumeRatio,
                        )}
                      </td>

                      <td>
                        <span
                          className={`direction ${getNumberDirectionClass(
                            row.disclosureScore,
                          )}`}
                        >
                          {formatPercent(
                            row.disclosureScore,
                          )}
                        </span>

                        <br />

                        <small>
                          긍정{" "}
                          {
                            row
                              .positiveDisclosureCount
                          }
                          건 · 부정{" "}
                          {
                            row
                              .negativeDisclosureCount
                          }
                          건
                        </small>
                      </td>

                      <td>
                        <span
                          className={
                            row.isCandidate
                              ? "predictionCandidateBadge active"
                              : "predictionCandidateBadge inactive"
                          }
                        >
                          {row.isCandidate
                            ? "상승 후보"
                            : "대기"}
                        </span>
                      </td>

                      <td>
                        <div className="predictionReasons">
                          {row.reasons
                            .slice(0, 3)
                            .map(
                              (
                                reason,
                                reasonIndex,
                              ) => (
                                <span
                                  key={`${row.id}-${reasonIndex}`}
                                >
                                  {reason}
                                </span>
                              ),
                            )}
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {actionMessage ? (
        <div className="controlMessage success">
          {actionMessage}
        </div>
      ) : null}

      {actionError ? (
        <div className="controlMessage error">
          {actionError}
        </div>
      ) : null}
    </section>
  );
}