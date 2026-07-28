"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface CycleStep {
  name: string;
  url: string;
}

interface CycleStepResult {
  name: string;
  ok: boolean;
  message: string;
}

const CYCLE_STEPS: CycleStep[] = [
  {
    name: "트레일링 손절 갱신",
    url: "/api/trading/trailing-stop/update",
  },
  {
    name: "손절 조건 검사",
    url: "/api/trading/stop-loss/check",
  },
  {
    name: "종료 거래 평가",
    url: "/api/trading/trades/evaluate",
  },
  {
    name: "모델 지표 갱신",
    url: "/api/models/metrics/refresh",
  },
];

function getResultMessage(
  stepName: string,
  payload: Record<string, unknown>,
): string {
  if (stepName === "트레일링 손절 갱신") {
    const checked = Number(
      payload.checked ?? 0,
    );

    const raised = Number(
      payload.raised ?? 0,
    );

    const triggered = Number(
      payload.triggered ?? 0,
    );

    return `확인 ${checked}건 · 상향 ${raised}건 · 발동 ${triggered}건`;
  }

  if (stepName === "손절 조건 검사") {
    const checked = Number(
      payload.checked ?? 0,
    );

    const triggered = Number(
      payload.triggered ?? 0,
    );

    const executed = Number(
      payload.executed ?? 0,
    );

    return `확인 ${checked}건 · 발동 ${triggered}건 · 매도 ${executed}건`;
  }

  if (stepName === "종료 거래 평가") {
    const checked = Number(
      payload.checked ??
        payload.tradeCount ??
        payload.count ??
        0,
    );

    const evaluated = Number(
      payload.evaluated ??
        payload.updated ??
        payload.count ??
        0,
    );

    return `확인 ${checked}건 · 평가 ${evaluated}건`;
  }

  if (stepName === "모델 지표 갱신") {
    const count = Number(
      payload.count ?? 0,
    );

    return `${count}개 모델 지표 갱신`;
  }

  return "완료";
}

async function executeStep(
  step: CycleStep,
): Promise<Record<string, unknown>> {
  const response = await fetch(step.url, {
    method: "POST",

    headers: {
      "Content-Type":
        "application/json; charset=utf-8",
    },

    body: JSON.stringify({}),
    cache: "no-store",
  });

  const rawText = await response.text();

  let payload: Record<string, unknown> = {};

  if (rawText) {
    try {
      payload = JSON.parse(
        rawText,
      ) as Record<string, unknown>;
    } catch {
      throw new Error(
        `${step.name}: 서버 응답이 JSON 형식이 아닙니다.`,
      );
    }
  }

  if (
    !response.ok ||
    payload.ok === false
  ) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `HTTP ${response.status}`;

    throw new Error(
      `${step.name}: ${message}`,
    );
  }

  return payload;
}

export default function TradingMaintenanceButton() {
  const router = useRouter();

  const [isRunning, setIsRunning] =
    useState(false);

  const [currentStep, setCurrentStep] =
    useState<string | null>(null);

  const [results, setResults] = useState<
    CycleStepResult[]
  >([]);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  async function runMaintenanceCycle() {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    setCurrentStep(null);
    setResults([]);
    setErrorMessage(null);

    const completedResults: CycleStepResult[] =
      [];

    try {
      for (const step of CYCLE_STEPS) {
        setCurrentStep(step.name);

        const payload =
          await executeStep(step);

        const result: CycleStepResult = {
          name: step.name,
          ok: true,
          message: getResultMessage(
            step.name,
            payload,
          ),
        };

        completedResults.push(result);

        setResults([
          ...completedResults,
        ]);
      }

      setCurrentStep(null);

      /*
       * 서버 컴포넌트 데이터를 다시 불러와
       * 모델 성과 표를 갱신한다.
       */
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "운영 사이클 실행 중 오류가 발생했습니다.";

      setErrorMessage(message);

      if (currentStep) {
        completedResults.push({
          name: currentStep,
          ok: false,
          message,
        });

        setResults([
          ...completedResults,
        ]);
      }
    } finally {
      setIsRunning(false);
      setCurrentStep(null);
    }
  }

  return (
    <div className="maintenanceControl">
      <button
        type="button"
        className="maintenanceButton"
        onClick={runMaintenanceCycle}
        disabled={isRunning}
      >
        {isRunning
          ? `${
              currentStep ??
              "운영 사이클"
            } 실행 중...`
          : "운영 사이클 실행"}
      </button>

      {results.length > 0 && (
        <div className="maintenanceResults">
          {results.map((result) => (
            <div
              key={result.name}
              className={
                result.ok
                  ? "maintenanceResult success"
                  : "maintenanceResult failure"
              }
            >
              <strong>
                {result.ok ? "✓" : "✕"}{" "}
                {result.name}
              </strong>

              <span>
                {result.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {errorMessage && (
        <p className="maintenanceError">
          {errorMessage}
        </p>
      )}
    </div>
  );
}