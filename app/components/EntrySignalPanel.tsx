"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  EntryModelOption,
  EntrySignalDashboardRow,
} from "@/lib/trading/get-entry-signal-dashboard";

interface EntrySignalPanelProps {
  signals: EntrySignalDashboardRow[];
  models: EntryModelOption[];
  errorMessage?: string | null;
}

interface GenerateResponse {
  ok?: boolean;
  message?: string;

  analyzed?: number;
  qualified?: number;
  eligible?: number;
  ordersCreated?: number;
}

function formatPrice(
  value: number,
): string {
  return `${new Intl.NumberFormat(
    "ko-KR",
  ).format(Math.round(value))}원`;
}

function formatScore(
  value: number,
): string {
  return `${(
    value * 100
  ).toFixed(1)}점`;
}

function formatDateTime(
  value: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const parts = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    },
  ).formatToParts(date);

  const partMap = Object.fromEntries(
    parts.map((part) => [
      part.type,
      part.value,
    ]),
  );

  return `${partMap.month}.${partMap.day} ${partMap.hour}:${partMap.minute}`;
}

function getStatusLabel(
  status: EntrySignalDashboardRow["status"],
): string {
  switch (status) {
    case "GENERATED":
      return "신호 생성";

    case "ORDER_CREATED":
      return "주문 생성";

    case "SKIPPED":
      return "제외";

    case "FAILED":
      return "실패";

    default:
      return status;
  }
}

function getStatusClass(
  status: EntrySignalDashboardRow["status"],
): string {
  switch (status) {
    case "ORDER_CREATED":
      return "up";

    case "FAILED":
      return "down";

    default:
      return "flat";
  }
}

export default function EntrySignalPanel({
  signals,
  models,
  errorMessage = null,
}: EntrySignalPanelProps) {
  const router = useRouter();

  const [modelId, setModelId] =
    useState(
      models[0]?.id ?? "",
    );

  const [autoOrder, setAutoOrder] =
    useState(false);

  const [maxOrders, setMaxOrders] =
    useState(1);

  const [isRunning, setIsRunning] =
    useState(false);

  const [resultMessage, setResultMessage] =
    useState<string | null>(null);

  const [runError, setRunError] =
    useState<string | null>(null);

  async function generateSignals() {
    if (isRunning) {
      return;
    }

    if (!modelId) {
      setRunError(
        "사용 가능한 ENTRY_TIMING 모델이 없습니다.",
      );

      return;
    }

    if (
      autoOrder &&
      !window.confirm(
        `조건을 통과한 종목에 최대 ${maxOrders}건의 모의주문을 생성합니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }

    setIsRunning(true);
    setRunError(null);
    setResultMessage(null);

    try {
      const response = await fetch(
        "/api/signals/entry/generate",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json; charset=utf-8",
          },

          body: JSON.stringify({
            modelId,
            autoOrder,
            maxOrders,
          }),

          cache: "no-store",
        },
      );

      const payload =
        (await response
          .json()
          .catch(() => ({}))) as GenerateResponse;

      if (
        !response.ok ||
        payload.ok === false
      ) {
        throw new Error(
          payload.message ??
            `HTTP ${response.status}`,
        );
      }

      setResultMessage(
        [
          `분석 ${payload.analyzed ?? 0}종목`,
          `기준 통과 ${payload.qualified ?? 0}종목`,
          `주문 가능 ${payload.eligible ?? 0}종목`,
          `주문 생성 ${payload.ordersCreated ?? 0}건`,
        ].join(" · "),
      );

      router.refresh();
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : "진입 신호 생성 중 오류가 발생했습니다.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section
      className="panel"
      id="entry-signals"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            ENTRY SIGNALS
          </p>

          <h2>
            AI 진입 신호
          </h2>

          <p className="subcopy">
            최신 시세에서 가격 모멘텀,
            장중 강도, 거래량과 종가 위치를
            분석합니다.
          </p>
        </div>

        <span className="statusPill">
          {errorMessage
            ? "조회 오류"
            : `${signals.length} signals`}
        </span>
      </div>

      <div className="signalControl">
        <label>
          <span>진입 모델</span>

          <select
            value={modelId}
            onChange={(event) =>
              setModelId(
                event.target.value,
              )
            }
            disabled={
              models.length === 0 ||
              isRunning
            }
          >
            {models.length === 0 ? (
              <option value="">
                사용 가능한 모델 없음
              </option>
            ) : (
              models.map((model) => (
                <option
                  key={model.id}
                  value={model.id}
                >
                  {model.name}
                  {" · "}
                  {model.version}
                  {" · "}
                  {model.status}
                </option>
              ))
            )}
          </select>
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
            기준 통과 시 모의주문 생성
          </span>
        </label>

        <label>
          <span>최대 주문 수</span>

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
          </select>
        </label>

        <button
          type="button"
          className="maintenanceButton"
          onClick={generateSignals}
          disabled={
            isRunning ||
            models.length === 0
          }
        >
          {isRunning
            ? "신호 분석 중..."
            : autoOrder
              ? "신호 분석 및 모의주문"
              : "진입 신호 생성"}
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
            진입 신호를 불러오지
            못했습니다.
          </h3>

          <p>{errorMessage}</p>
        </div>
      ) : signals.length === 0 ? (
        <div className="emptyState">
          <h3>
            생성된 진입 신호가 없습니다.
          </h3>

          <p>
            시세 동기화 후 진입 신호 생성
            버튼을 눌러 주세요.
          </p>
        </div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>생성 시각</th>
                <th>종목</th>
                <th>점수</th>
                <th>상태</th>
                <th>진입가</th>
                <th>손절가</th>
                <th>모델</th>
                <th>주문</th>
                <th>판단 이유</th>
              </tr>
            </thead>

            <tbody>
              {signals.map(
                (signal) => (
                  <tr key={signal.id}>
                    <td>
                      {formatDateTime(
                        signal.createdAt,
                      )}
                    </td>

                    <td>
                      <strong>
                        {signal.stockName}
                      </strong>

                      <br />

                      <small>
                        {signal.stockCode}
                      </small>
                    </td>

                    <td>
                      <strong>
                        {formatScore(
                          signal.score,
                        )}
                      </strong>
                    </td>

                    <td>
                      <span
                        className={`direction ${getStatusClass(
                          signal.status,
                        )}`}
                      >
                        {getStatusLabel(
                          signal.status,
                        )}
                      </span>

                      {signal.errorMessage && (
                        <>
                          <br />

                          <small>
                            {
                              signal.errorMessage
                            }
                          </small>
                        </>
                      )}
                    </td>

                    <td>
                      {formatPrice(
                        signal.entryPrice,
                      )}
                    </td>

                    <td>
                      {formatPrice(
                        signal.stopPrice,
                      )}

                      <br />

                      <small>
                        {(
                          (
                            signal.stopPrice /
                              signal.entryPrice -
                            1
                          ) *
                          100
                        ).toFixed(2)}
                        %
                      </small>
                    </td>

                    <td>
                      <strong>
                        {signal.modelName}
                      </strong>

                      <br />

                      <small>
                        {
                          signal.modelVersion
                        }
                        {" · "}
                        {
                          signal.modelStatus
                        }
                      </small>
                    </td>

                    <td>
                      {signal.orderId ? (
                        <>
                          <span className="direction up">
                            연결 완료
                          </span>

                          <br />

                          <small>
                            {signal.orderId.slice(
                              0,
                              8,
                            )}
                          </small>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>

                    <td>
                      <small>
                        {signal.reasons[0] ??
                          "판단 이유 없음"}
                      </small>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="signalWarning">
        자동주문은 모의투자 주문만 생성합니다.
        처음에는 최대 주문 수를 1건으로
        유지하세요.
      </div>
    </section>
  );
}