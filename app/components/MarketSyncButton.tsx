"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface SyncResult {
  ok: boolean;
  requested?: number;
  saved?: number;
  failures?: Array<{
    stockCode: string;
    stockName: string;
    message: string;
  }>;
  message?: string;
}

export default function MarketSyncButton() {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    try {
      setIsLoading(true);
      setMessage(null);

      const response = await fetch("/api/market/sync", {
        method: "POST",
      });

      const result = (await response.json()) as SyncResult;

      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "시세 수집에 실패했습니다.");
      }

      const failureCount = result.failures?.length ?? 0;

      setMessage(
        failureCount === 0
          ? `${result.saved ?? 0}개 종목의 시세를 저장했습니다.`
          : `${result.saved ?? 0}개 저장, ${failureCount}개 실패했습니다.`,
      );

      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "시세 수집 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <button
        className="primaryButton"
        type="button"
        disabled={isLoading}
        onClick={handleSync}
      >
        {isLoading ? "시세 수집 중..." : "최신 시세 수집"}
      </button>

      {message ? (
        <p
          style={{
            marginTop: "10px",
            maxWidth: "260px",
            fontSize: "13px",
          }}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}