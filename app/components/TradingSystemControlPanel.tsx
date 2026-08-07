"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type ControlAction =
  | "EMERGENCY_STOP"
  | "PAUSE_AUTOMATION"
  | "RESUME_AUTOMATION"
  | "ENABLE_PAPER_ORDERS"
  | "DISABLE_PAPER_ORDERS"
  | "SET_MAX_ORDERS";

interface TradingSystemControl {
  controlKey: string;

  automationEnabled: boolean;
  paperOrderEnabled: boolean;
  realOrderEnabled: boolean;
  emergencyStop: boolean;

  emergencyReason: string | null;

  maxOrdersPerCycle: number;

  updatedBy: string;
  updatedAt: string;
}

interface ControlGetResponse {
  ok: boolean;
  control?: TradingSystemControl;
  message?: string;
}

interface ControlPostResponse {
  ok: boolean;
  action?: ControlAction;
  message?: string;
}

function formatKoreaDateTime(
  value: string,
): string {
  const date = new Date(value);

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

export default function TradingSystemControlPanel() {
  const [
    control,
    setControl,
  ] =
    useState<TradingSystemControl | null>(
      null,
    );

  const [
    selectedMaxOrders,
    setSelectedMaxOrders,
  ] = useState(1);

  const [
    isLoading,
    setIsLoading,
  ] = useState(true);

  const [
    pendingAction,
    setPendingAction,
  ] =
    useState<ControlAction | null>(
      null,
    );

  const [
    message,
    setMessage,
  ] = useState<string | null>(
    null,
  );

  const [
    errorMessage,
    setErrorMessage,
  ] = useState<string | null>(
    null,
  );

  const loadControl =
    useCallback(async () => {
      try {
        setErrorMessage(null);

        const response =
          await fetch(
            "/api/trading/system/control",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const payload =
          (await response.json()) as ControlGetResponse;

        if (
          !response.ok ||
          !payload.ok ||
          !payload.control
        ) {
          throw new Error(
            payload.message ??
              "시스템 제어 상태를 불러오지 못했습니다.",
          );
        }

        setControl(
          payload.control,
        );

        setSelectedMaxOrders(
          payload.control
            .maxOrdersPerCycle,
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "시스템 제어 상태 조회 중 오류가 발생했습니다.",
        );
      } finally {
        setIsLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadControl();
  }, [loadControl]);

  async function runAction(
    action: ControlAction,
    extraBody: Record<
      string,
      unknown
    > = {},
  ) {
    if (
      action ===
      "EMERGENCY_STOP"
    ) {
      const confirmed =
        window.confirm(
          [
            "비상정지를 실행하시겠습니까?",
            "",
            "자동 운영과 신규 주문 생성이 즉시 차단됩니다.",
          ].join("\n"),
        );

      if (!confirmed) {
        return;
      }
    }

    try {
      setPendingAction(
        action,
      );

      setMessage(null);
      setErrorMessage(null);

      const response =
        await fetch(
          "/api/trading/system/control",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json; charset=utf-8",
            },

            body: JSON.stringify({
              action,
              ...extraBody,
            }),
          },
        );

      const payload =
        (await response.json()) as ControlPostResponse;

      if (
        !response.ok ||
        !payload.ok
      ) {
        throw new Error(
          payload.message ??
            "시스템 제어 명령 실행에 실패했습니다.",
        );
      }

      const actionMessages:
        Record<
          ControlAction,
          string
        > = {
        EMERGENCY_STOP:
          "비상정지가 실행되었습니다.",

        PAUSE_AUTOMATION:
          "자동 운영이 일시정지되었습니다.",

        RESUME_AUTOMATION:
          "자동 운영이 재개되었습니다. 모의주문은 안전을 위해 비활성 상태입니다.",

        ENABLE_PAPER_ORDERS:
          "모의주문 자동생성이 활성화되었습니다.",

        DISABLE_PAPER_ORDERS:
          "모의주문 자동생성이 비활성화되었습니다.",

        SET_MAX_ORDERS:
          `사이클당 최대 주문 수를 ${selectedMaxOrders}개로 변경했습니다.`,
      };

      setMessage(
        actionMessages[action],
      );

      await loadControl();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "시스템 제어 중 오류가 발생했습니다.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  const isBusy =
    pendingAction !== null;

  return (
    <section
      className="panel safetyControlPanel"
      id="system-control"
    >
      <div className="panelHeader">
        <div>
          <p className="eyebrow">
            SAFETY CONTROL
          </p>

          <h2>
            자동매매 안전제어
          </h2>

          <p className="subcopy">
            자동 운영, 모의주문 생성,
            주문 수 제한과 비상정지를
            관리합니다.
          </p>
        </div>

        <span
          className={`systemStatePill ${
            control?.emergencyStop
              ? "critical"
              : control?.automationEnabled
                ? "normal"
                : "paused"
          }`}
        >
          {control?.emergencyStop
            ? "비상정지"
            : control?.automationEnabled
              ? "운영 가능"
              : "일시정지"}
        </span>
      </div>

      {isLoading ? (
        <div className="emptyState">
          <p>
            시스템 제어 상태를
            불러오는 중입니다.
          </p>
        </div>
      ) : errorMessage &&
        !control ? (
        <div className="emptyState">
          <h3>
            제어 상태 조회 실패
          </h3>

          <p>
            {errorMessage}
          </p>

          <button
            type="button"
            className="controlButton secondary"
            onClick={() => {
              setIsLoading(true);
              void loadControl();
            }}
          >
            다시 조회
          </button>
        </div>
      ) : control ? (
        <>
          <div className="safetyStatusGrid">
            <article className="safetyStatusCard">
              <span>
                자동 운영
              </span>

              <strong
                className={
                  control.automationEnabled
                    ? "stateEnabled"
                    : "stateDisabled"
                }
              >
                {control.automationEnabled
                  ? "활성"
                  : "중지"}
              </strong>
            </article>

            <article className="safetyStatusCard">
              <span>
                모의주문 생성
              </span>

              <strong
                className={
                  control.paperOrderEnabled
                    ? "stateEnabled"
                    : "stateDisabled"
                }
              >
                {control.paperOrderEnabled
                  ? "허용"
                  : "차단"}
              </strong>
            </article>

            <article className="safetyStatusCard">
              <span>
                실거래 주문
              </span>

              <strong className="stateDisabled">
                비활성
              </strong>
            </article>

            <article className="safetyStatusCard">
              <span>
                사이클 주문 제한
              </span>

              <strong>
                {
                  control.maxOrdersPerCycle
                }
                개
              </strong>
            </article>
          </div>

          {control.emergencyStop ? (
            <div className="emergencyBanner">
              <strong>
                비상정지 상태
              </strong>

              <p>
                {control.emergencyReason ??
                  "비상정지가 실행되어 있습니다."}
              </p>
            </div>
          ) : null}

          <div className="controlButtonGrid">
            <button
              type="button"
              className="controlButton danger"
              disabled={isBusy}
              onClick={() =>
                void runAction(
                  "EMERGENCY_STOP",
                  {
                    reason:
                      "대시보드에서 비상정지를 실행했습니다.",
                  },
                )
              }
            >
              {pendingAction ===
              "EMERGENCY_STOP"
                ? "정지 중..."
                : "비상정지"}
            </button>

            {control.automationEnabled &&
            !control.emergencyStop ? (
              <button
                type="button"
                className="controlButton warning"
                disabled={isBusy}
                onClick={() =>
                  void runAction(
                    "PAUSE_AUTOMATION",
                  )
                }
              >
                {pendingAction ===
                "PAUSE_AUTOMATION"
                  ? "정지 중..."
                  : "자동 운영 일시정지"}
              </button>
            ) : (
              <button
                type="button"
                className="controlButton primary"
                disabled={isBusy}
                onClick={() =>
                  void runAction(
                    "RESUME_AUTOMATION",
                  )
                }
              >
                {pendingAction ===
                "RESUME_AUTOMATION"
                  ? "재개 중..."
                  : "자동 운영 재개"}
              </button>
            )}

            {control.paperOrderEnabled ? (
              <button
                type="button"
                className="controlButton warning"
                disabled={isBusy}
                onClick={() =>
                  void runAction(
                    "DISABLE_PAPER_ORDERS",
                  )
                }
              >
                {pendingAction ===
                "DISABLE_PAPER_ORDERS"
                  ? "차단 중..."
                  : "모의주문 생성 차단"}
              </button>
            ) : (
              <button
                type="button"
                className="controlButton primary"
                disabled={
                  isBusy ||
                  control.emergencyStop ||
                  !control.automationEnabled
                }
                onClick={() =>
                  void runAction(
                    "ENABLE_PAPER_ORDERS",
                  )
                }
              >
                {pendingAction ===
                "ENABLE_PAPER_ORDERS"
                  ? "활성화 중..."
                  : "모의주문 생성 허용"}
              </button>
            )}
          </div>

          <div className="orderLimitControl">
            <div>
              <strong>
                사이클당 최대 주문 수
              </strong>

              <p>
                한 번의 자동 운영에서
                생성할 수 있는 신규
                모의주문의 최대 수입니다.
              </p>
            </div>

            <div className="orderLimitActions">
              <select
                value={
                  selectedMaxOrders
                }
                disabled={isBusy}
                onChange={(event) =>
                  setSelectedMaxOrders(
                    Number(
                      event.target.value,
                    ),
                  )
                }
              >
                {[1, 2, 3, 4, 5].map(
                  (value) => (
                    <option
                      key={value}
                      value={value}
                    >
                      {value}개
                    </option>
                  ),
                )}
              </select>

              <button
                type="button"
                className="controlButton secondary"
                disabled={
                  isBusy ||
                  selectedMaxOrders ===
                    control.maxOrdersPerCycle
                }
                onClick={() =>
                  void runAction(
                    "SET_MAX_ORDERS",
                    {
                      maxOrdersPerCycle:
                        selectedMaxOrders,
                    },
                  )
                }
              >
                제한 적용
              </button>
            </div>
          </div>

          {message ? (
            <div className="controlMessage success">
              {message}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="controlMessage error">
              {errorMessage}
            </div>
          ) : null}

          <div className="controlFooter">
            <span>
              최종 변경자:{" "}
              {control.updatedBy}
            </span>

            <span>
              최종 변경:{" "}
              {formatKoreaDateTime(
                control.updatedAt,
              )}
            </span>
          </div>

          <p className="realTradingWarning">
            실거래 주문은 현재 강제로
            비활성화되어 있으며, 이
            화면에서는 활성화할 수 없습니다.
          </p>
        </>
      ) : null}
    </section>
  );
}