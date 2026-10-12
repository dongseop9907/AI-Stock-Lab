import {
  getDomesticStockOrderbook,
  getKisAccessToken,
  type KisDomesticOrderbookOutput,
} from "@/lib/kis/client";

import type {
  PaperQuoteSnapshot,
} from "@/lib/trading/paper-execution-realism-v2";

export type PaperExecutionOrderbookQuoteSource =
  | "KIS_DOMESTIC_ORDERBOOK_REST"
  | "KIS_ORDERBOOK_EMPTY"
  | "KIS_ORDERBOOK_READ_FAILED";

export interface PaperExecutionOrderbookQuoteResult {
  quote:
    | PaperQuoteSnapshot
    | null;

  source:
    PaperExecutionOrderbookQuoteSource;

  error:
    | string
    | null;
}

function toPositiveNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(
      String(value)
        .replaceAll(
          ",",
          "",
        ),
    );

  return (
    Number.isFinite(
      parsed,
    ) &&
    parsed > 0
  )
    ? parsed
    : null;
}

function toNonNegativeInteger(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(
      String(value)
        .replaceAll(
          ",",
          "",
        ),
    );

  return (
    Number.isFinite(
      parsed,
    ) &&
    parsed >= 0
  )
    ? Math.floor(
        parsed,
      )
    : null;
}

export function buildPaperQuoteSnapshotFromKisOrderbook(
  output:
    | KisDomesticOrderbookOutput
    | null
    | undefined,
  observedAt:
    string | Date,
): PaperQuoteSnapshot | null {
  if (
    !output
  ) {
    return null;
  }

  const bestAskPrice =
    toPositiveNumber(
      output.askp1,
    );

  const bestBidPrice =
    toPositiveNumber(
      output.bidp1,
    );

  if (
    bestAskPrice === null &&
    bestBidPrice === null
  ) {
    return null;
  }

  return {
    observedAt,

    bestAskPrice,
    bestBidPrice,

    bestAskQuantity:
      toNonNegativeInteger(
        output.askp_rsqn1,
      ),

    bestBidQuantity:
      toNonNegativeInteger(
        output.bidp_rsqn1,
      ),
  };
}

export async function resolvePaperExecutionRealismV2OrderbookQuote(
  input: {
    stockCode: string;
  },
): Promise<PaperExecutionOrderbookQuoteResult> {
  try {
    const accessToken =
      await getKisAccessToken();

    const response =
      await getDomesticStockOrderbook(
        input.stockCode,
        accessToken,
      );

    const observedAt =
      new Date().toISOString();

    const quote =
      buildPaperQuoteSnapshotFromKisOrderbook(
        response.output1,
        observedAt,
      );

    if (
      !quote
    ) {
      return {
        quote:
          null,
        source:
          "KIS_ORDERBOOK_EMPTY",
        error:
          null,
      };
    }

    return {
      quote,
      source:
        "KIS_DOMESTIC_ORDERBOOK_REST",
      error:
        null,
    };
  }
  catch (
    error
  ) {
    return {
      quote:
        null,
      source:
        "KIS_ORDERBOOK_READ_FAILED",
      error:
        String(
          error instanceof
            Error
            ? error.message
            : error,
        ),
    };
  }
}
