"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  AutomationRunDashboardRow,
  AutomationRunStatus,
} from "@/lib/trading/get-automation-run-dashboard";

interface AutomationRunPanelProps {
  runs: AutomationRunDashboardRow[];
  errorMessage?: string | null;
}

interface AutomationResponse {
  ok?: boolean;

  status?: AutomationRunStatus;

  message?: string;

  summary?: {
    successCount?: number;
    failureCount?: number;
    completedSteps?: number;
  };

  steps?: Array<{
    name?: string;
    ok?: boolean;
    error?: string | null;
  }>;
}

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
        second: "2-digit",
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

  return `${values.year}.${values.month}.${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function getStatusLabel(
  status: AutomationRunStatus,
): string {
  switch (status) {
    case "RUNNING":
      return "실행 중";

    case "SUCCESS":
      return "성공";

    case "PARTIAL_FAILURE":
      return "일부 실패";

    case "FAILED":
      return "실패";

    default:
      return status;
  }
}

function getStatusClass(
  status: AutomationRunStatus,
): "up" | "down" | "flat" {
  if (status === "SUCCESS") {
    return "up";
  }

  if (
    status === "FAILED" ||
    status ===
      "PARTIAL_FAILURE"
  ) {
    return "down";
  }

  return "flat";
}

export default function AutomationRunPanel({
  runs,
  errorMessage = null,
}: AutomationRunPanelProps) {
  const router = useRouter();

  const [
    includeMarketSync,
    setIncludeMarketSync,
  ] = useState(true);

  const [
    autoOrder,
    setAutoOrder,
  ] = useState(false);

  const [
    maxOrders,
    setMaxOrders,
  ] = useState(1);

  const [
    isRunning,
    setIsRunning,
  ] = useState(false);

  const [
    resultMessage,
    setResultMessage,
  ] = useState<string | null>(
    null,
  );

  const [
    runError,
    setRunError,
  ] = useState<string | null>(
    null,
  );

  async function runAutomation() {
    if (isRunning) {
      return;
    }

    if (
      autoOrder &&
      !window.confirm(
        `조건을 통과한 종목을 최대 ${maxOrders}건까지 모의체결합니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }

    setIsRunning(true);
    setResultMessage(null);
    setRunError(null);

    try {
      const response = await fetch(
        "/api/trading/automation/run",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json; charset=utf-8",
          },

          body: JSON.stringify({
            triggerType:
              "MANUAL",

            includeMarketSync,
            autoOrder,
            maxOrders,
          }),

          cache: "no-store",
        },
      );

      const payload =
        (await response
          .json()
          .catch(
            () => ({}),
          )) as AutomationResponse;

      if (!response.ok) {
        throw new Error(
          payload.message ??
            `HTTP ${response.status}`,
        );
      }

      const status =
        payload.status ??
        "FAILED";

      setResultMessage(
        [
          `상태 ${getStatusLabel(
            status,
          )}`,

          `완료 ${
            payload.summary
              ?.completedSteps ?? 0
          }단계`,

          `성공 ${
            payload.summary
              ?.successCount ?? 0
          }단계`,

          `실패 ${
            payload.summary
              ?.failureCount ?? 0
          }단계`,
        ].join(" · "),
      );

      if (
        status !== "SUCCESS"
      ) {
        const failures =
          payload.steps
            ?.filter(
              (step) =>
                step.ok === false,
            )
            .map(
              (step) =>
                `${step.name ?? "단계"}: ${
                  step.error ??
                  "실패"
                }`,
            )
            .join(" / ");

        setRunError(
          failures ||
            payload.message ||
            "일부 단계가 실패했습니다.",
        );
      }

      router.refresh();
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : "자동 운영 실행 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section
      className="panel"
      id="automation-runs"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            AUTOMATION
          </p>

          <h2>
            자동 운영 사이클
          </h2>

          <p className="subcopy">
            시세 동기화부터 진입 신호,
            모의체결, 손절 관리와 모델
            평가까지 순서대로 실행합니다.
          </p>
        </div>

        <span className="statusPill">
          {errorMessage
            ? "조회 오류"
            : `${runs.length} runs`}
        </span>
      </div>

      <div className="automationControl">
        <label className="signalCheckbox">
          <input
            type="checkbox"
            checked={
              includeMarketSync
            }
            onChange={(event) =>
              setIncludeMarketSync(
                event.target.checked,
              )
            }
            disabled={isRunning}
          />

          <span>
            실행 전 시세 동기화
          </span>
        </label>

        <label className="signalCheckbox">
          <input
            type="checkbox"
            checked={autoOrder}
            onChange={(event) =>
              setAutoOrder(
                event.target.checked,
              )
            }
            disabled={isRunning}
          />

          <span>
            신호 통과 시 모의체결
          </span>
        </label>

        <label>
          <span>최대 체결 수</span>

          <select
            value={maxOrders}
            onChange={(event) =>
              setMaxOrders(
                Number(
                  event.target.value,
                ),
              )
            }
            disabled={
              !autoOrder ||
              isRunning
            }
          >
            <option value={1}>
              1건
            </option>

            <option value={2}>
              2건
            </option>

            <option value={3}>
              3건
            </option>

            <option value={5}>
              5건
            </option>
          </select>
        </label>

        <button
          type="button"
          className="maintenanceButton"
          onClick={runAutomation}
          disabled={isRunning}
        >
          {isRunning
            ? "운영 사이클 실행 중..."
            : autoOrder
              ? "자동 운영 및 모의체결"
              : "자동 운영 점검 실행"}
        </button>
      </div>

      {resultMessage && (
        <p className="signalResult success">
          ✓ {resultMessage}
        </p>
      )}

      {runError && (
        <p className="signalResult failure">
          ✕ {runError}
        </p>
      )}

      {errorMessage ? (
        <div className="emptyState">
          <h3>
            자동 운영 기록을 불러오지
            못했습니다.
          </h3>

          <p>{errorMessage}</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="emptyState">
          <h3>
            자동 운영 실행 기록이
            없습니다.
          </h3>

          <p>
            먼저 자동 운영 점검 실행을
            눌러 주세요.
          </p>
        </div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>실행 시각</th>
                <th>실행 방식</th>
                <th>상태</th>
                <th>성공/실패</th>
                <th>운영 설정</th>
                <th>실행 단계</th>
                <th>오류</th>
              </tr>
            </thead>

            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    {formatDateTime(
                      run.startedAt,
                    )}
                  </td>

                  <td>
                    {run.triggerType ===
                    "SCHEDULED"
                      ? "예약 실행"
                      : "수동 실행"}
                  </td>

                  <td>
                    <span
                      className={`direction ${getStatusClass(
                        run.status,
                      )}`}
                    >
                      {getStatusLabel(
                        run.status,
                      )}
                    </span>
                  </td>

                  <td>
                    <strong>
                      {run.successCount}
                    </strong>
                    {" / "}
                    {run.failureCount}
                  </td>

                  <td>
                    <small>
                      시세{" "}
                      {run.includeMarketSync
                        ? "포함"
                        : "제외"}
                      <br />
                      주문{" "}
                      {run.autoOrder
                        ? `최대 ${run.maxOrders}건`
                        : "미생성"}
                    </small>
                  </td>

                  <td>
                    <small>
                      {run.steps.length >
                      0
                        ? run.steps
                            .map(
                              (
                                step,
                              ) =>
                                `${
                                  step.ok
                                    ? "✓"
                                    : "✕"
                                } ${
                                  step.name
                                }`,
                            )
                            .join(
                              " · ",
                            )
                        : "단계 기록 없음"}
                    </small>
                  </td>

                  <td>
                    <small>
                      {run.errorMessage ??
                        run.steps.find(
                          (step) =>
                            !step.ok,
                        )?.error ??
                        "-"}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="signalWarning">
        자동주문은 모의투자에만 적용됩니다.
        초기 테스트에서는 최대 체결 수를
        1건으로 유지하세요.
      </div>
    </section>
  );
}