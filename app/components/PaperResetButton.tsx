"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ResetResponse {
  ok?: boolean;
  message?: string;

  result?: {
    restoredCash?: number;

    deleted?: {
      signals?: number;
      evaluations?: number;
      stopAdjustments?: number;
      trades?: number;
      positions?: number;
      orders?: number;
      riskDecisions?: number;
    };
  };
}

export default function PaperResetButton() {
  const router = useRouter();

  const [isResetting, setIsResetting] =
    useState(false);

  const [message, setMessage] =
    useState<string | null>(null);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  async function resetPaperAccount() {
    if (isResetting) {
      return;
    }

    const confirmation =
      window.prompt(
        [
          "모의주문, 보유 포지션, 거래 이력과 손절 평가가 모두 삭제됩니다.",
          "",
          "시장 시세와 AI 모델은 유지됩니다.",
          "",
          "계속하려면 아래 문구를 입력하세요.",
          "초기화",
        ].join("\n"),
      );

    if (confirmation === null) {
      return;
    }

    if (confirmation.trim() !== "초기화") {
      setMessage(null);

      setErrorMessage(
        "'초기화'를 정확히 입력해야 합니다.",
      );

      return;
    }

    setIsResetting(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch(
        "/api/trading/paper/reset",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json; charset=utf-8",
          },

          body: JSON.stringify({
            confirmation:
              "RESET_PAPER_ACCOUNT",

            accountName:
              "default-paper",
          }),

          cache: "no-store",
        },
      );

      const payload =
        (await response
          .json()
          .catch(() => ({}))) as ResetResponse;

      if (
        !response.ok ||
        payload.ok === false
      ) {
        throw new Error(
          payload.message ??
            `HTTP ${response.status}`,
        );
      }

      const deleted =
        payload.result?.deleted;

      setMessage(
        [
          "모의계좌 초기화 완료",
          `주문 ${deleted?.orders ?? 0}건`,
          `포지션 ${deleted?.positions ?? 0}건`,
          `거래 ${deleted?.trades ?? 0}건`,
          `신호 ${deleted?.signals ?? 0}건 삭제`,
        ].join(" · "),
      );

      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "모의계좌 초기화 중 오류가 발생했습니다.",
      );
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="paperResetControl">
      <button
        type="button"
        className="paperResetButton"
        onClick={resetPaperAccount}
        disabled={isResetting}
      >
        {isResetting
          ? "초기화 중..."
          : "모의계좌 초기화"}
      </button>

      {message && (
        <p className="paperResetMessage success">
          ✓ {message}
        </p>
      )}

      {errorMessage && (
        <p className="paperResetMessage failure">
          ✕ {errorMessage}
        </p>
      )}
    </div>
  );
}