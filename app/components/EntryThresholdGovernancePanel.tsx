"use client";

import {
  useRouter,
} from "next/navigation";

import {
  useState,
} from "react";

import type {
  EntryThresholdGovernance,
  ThresholdRecommendationStatus,
} from "@/lib/trading/get-entry-threshold-governance";

interface EntryThresholdGovernancePanelProps {
  data:
    | EntryThresholdGovernance
    | null;

  errorMessage?:
    | string
    | null;
}

type Action =
  | "ANALYZE"
  | "APPLY"
  | "REJECT";

function formatThreshold(
  value: number | null,
): string {
  if (value === null) {
    return "-";
  }

  return value.toFixed(2);
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

function getStatusLabel(
  status:
    ThresholdRecommendationStatus,
): string {
  switch (status) {
    case "INSUFFICIENT_DATA":
      return "표본 부족";

    case "NO_CHANGE":
      return "변경 불필요";

    case "RECOMMENDED":
      return "승인 대기";

    case "APPROVED":
      return "승인됨";

    case "REJECTED":
      return "거절됨";

    case "APPLIED":
      return "적용됨";
  }
}

function getStatusClass(
  status:
    ThresholdRecommendationStatus,
): string {
  switch (status) {
    case "RECOMMENDED":
      return "warning";

    case "APPLIED":
    case "APPROVED":
      return "good";

    case "REJECTED":
      return "bad";

    default:
      return "neutral";
  }
}

export default function EntryThresholdGovernancePanel({
  data,
  errorMessage = null,
}: EntryThresholdGovernancePanelProps) {
  const router =
    useRouter();

  const [
    pendingAction,
    setPendingAction,
  ] =
    useState<Action | null>(
      null,
    );

  const [
    message,
    setMessage,
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

  async function runAction(
    action: Action,
    recommendationId?: string,
  ) {
    if (
      action === "APPLY"
    ) {
      const confirmed =
        window.confirm(
          [
            "추천 기준점수를 실제 진입 기준으로 적용하시겠습니까?",
            "",
            "적용 이후 생성되는 신호부터 새 기준점수가 사용됩니다.",
          ].join("\n"),
        );

      if (!confirmed) {
        return;
      }
    }

    try {
      setPendingAction(action);
      setMessage(null);
      setActionError(null);

      const response =
        await fetch(
          "/api/models/entry-threshold/governance",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json; charset=utf-8",
            },

            body: JSON.stringify({
              action,
              recommendationId,
              approvedBy:
                "LOCAL_DASHBOARD",
            }),
          },
        );

      const payload =
        (await response.json()) as {
          ok: boolean;
          message?: string;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        throw new Error(
          payload.message ??
            "기준점수 명령 실행에 실패했습니다.",
        );
      }

      const messages:
        Record<
          Action,
          string
        > = {
        ANALYZE:
          "진입 기준점수 분석을 완료했습니다.",

        APPLY:
          "추천 기준점수를 실제 설정에 적용했습니다.",

        REJECT:
          "추천 기준점수를 거절했습니다.",
      };

      setMessage(
        messages[action],
      );

      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "기준점수 관리 중 오류가 발생했습니다.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  const latest =
    data?.latestRecommendation ??
    null;

  const isBusy =
    pendingAction !== null;

  return (
    <section
      className="panel"
      id="entry-threshold"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            THRESHOLD GOVERNANCE
          </p>

          <h2>
            진입 기준점수 관리
          </h2>

          <p className="subcopy">
            그림자 평가 결과를 분석해
            추천값을 생성하고, 승인된
            기준점수만 실제 신호에 적용합니다.
          </p>
        </div>

        <button
          type="button"
          className="controlButton primary"
          disabled={isBusy}
          onClick={() =>
            void runAction(
              "ANALYZE",
            )
          }
        >
          {pendingAction ===
          "ANALYZE"
            ? "분석 중..."
            : "지금 분석"}
        </button>
      </div>

      {errorMessage ? (
        <div className="emptyState">
          <h3>
            기준점수 정보를 불러오지 못했습니다.
          </h3>

          <p>{errorMessage}</p>
        </div>
      ) : !data ? (
        <div className="emptyState">
          <p>
            기준점수 관리 정보가 없습니다.
          </p>
        </div>
      ) : (
        <>
          <div className="metricGrid">
            <article className="metricCard">
              <span>
                현재 적용 기준
              </span>

              <strong>
                {formatThreshold(
                  data.setting
                    .activeThreshold,
                )}
              </strong>

              <small>
                점수 이상 진입 후보
              </small>
            </article>

            <article className="metricCard">
              <span>
                이전 기준
              </span>

              <strong>
                {formatThreshold(
                  data.setting
                    .previousThreshold,
                )}
              </strong>

              <small>
                마지막 적용 전 기준
              </small>
            </article>

            <article className="metricCard">
              <span>
                최신 추천
              </span>

              <strong>
                {formatThreshold(
                  latest
                    ?.recommendedThreshold ??
                    null,
                )}
              </strong>

              <small>
                {latest
                  ? getStatusLabel(
                      latest.status,
                    )
                  : "분석 기록 없음"}
              </small>
            </article>

            <article className="metricCard">
              <span>
                분석 표본
              </span>

              <strong>
                {latest
                  ?.sampleCount ??
                  0}
                건
              </strong>

              <small>
                최소 30건 필요
              </small>
            </article>

            <article className="metricCard">
              <span>
                예상 성능 개선
              </span>

              <strong>
                {formatPercent(
                  latest
                    ?.objectiveImprovement ??
                    null,
                )}
              </strong>

              <small>
                종합 목적점수 기준
              </small>
            </article>
          </div>

          {latest ? (
            <div className="thresholdRecommendationCard">
              <div>
                <span
                  className={`thresholdStatusBadge ${getStatusClass(
                    latest.status,
                  )}`}
                >
                  {getStatusLabel(
                    latest.status,
                  )}
                </span>

                <h3>
                  현재{" "}
                  {formatThreshold(
                    latest.currentThreshold,
                  )}
                  {" → "}
                  추천{" "}
                  {formatThreshold(
                    latest.recommendedThreshold,
                  )}
                </h3>

                <p>
                  전체 표본{" "}
                  {latest.sampleCount}건 ·
                  진입 필요{" "}
                  {latest.positiveCount}건 ·
                  진입 불필요{" "}
                  {latest.negativeCount}건
                </p>

                <small>
                  분석 시각:{" "}
                  {formatDateTime(
                    latest.createdAt,
                  )}
                </small>
              </div>

              {latest.status ===
              "RECOMMENDED" ? (
                <div className="thresholdActionGroup">
                  <button
                    type="button"
                    className="controlButton primary"
                    disabled={isBusy}
                    onClick={() =>
                      void runAction(
                        "APPLY",
                        latest.id,
                      )
                    }
                  >
                    추천 적용
                  </button>

                  <button
                    type="button"
                    className="controlButton secondary"
                    disabled={isBusy}
                    onClick={() =>
                      void runAction(
                        "REJECT",
                        latest.id,
                      )
                    }
                  >
                    추천 거절
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="emptyState">
              <p>
                아직 기준점수 분석 기록이 없습니다.
              </p>
            </div>
          )}

          {message ? (
            <div className="controlMessage success">
              {message}
            </div>
          ) : null}

          {actionError ? (
            <div className="controlMessage error">
              {actionError}
            </div>
          ) : null}

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>분석 시각</th>
                  <th>현재 기준</th>
                  <th>추천 기준</th>
                  <th>표본</th>
                  <th>진입 필요</th>
                  <th>진입 불필요</th>
                  <th>개선도</th>
                  <th>상태</th>
                </tr>
              </thead>

              <tbody>
                {data.recommendations.map(
                  (recommendation) => (
                    <tr
                      key={
                        recommendation.id
                      }
                    >
                      <td>
                        {formatDateTime(
                          recommendation
                            .createdAt,
                        )}
                      </td>

                      <td>
                        {formatThreshold(
                          recommendation
                            .currentThreshold,
                        )}
                      </td>

                      <td>
                        {formatThreshold(
                          recommendation
                            .recommendedThreshold,
                        )}
                      </td>

                      <td>
                        {
                          recommendation
                            .sampleCount
                        }
                        건
                      </td>

                      <td>
                        {
                          recommendation
                            .positiveCount
                        }
                        건
                      </td>

                      <td>
                        {
                          recommendation
                            .negativeCount
                        }
                        건
                      </td>

                      <td>
                        {formatPercent(
                          recommendation
                            .objectiveImprovement,
                        )}
                      </td>

                      <td>
                        <span
                          className={`thresholdStatusBadge ${getStatusClass(
                            recommendation.status,
                          )}`}
                        >
                          {getStatusLabel(
                            recommendation.status,
                          )}
                        </span>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>

          <div className="controlFooter">
            <span>
              변경자:{" "}
              {data.setting.updatedBy}
            </span>

            <span>
              최종 변경:{" "}
              {formatDateTime(
                data.setting.updatedAt,
              )}
            </span>
          </div>
        </>
      )}
    </section>
  );
}