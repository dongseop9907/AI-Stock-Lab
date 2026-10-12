const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const FILES = {
  kis:
    "lib/kis/client.ts",

  buy:
    "lib/trading/execute-paper-order.ts",

  sell:
    "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
};

const BACKUP_DIR =
  path.join(
    ROOT,
    "scripts",
    "backups",
    "paper-orderbook-binding-v1",
  );

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_ORDERBOOK_BINDING_V1_PATCH_FAIL",
        reason,
        ...extra,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    1;
}

function load(
  rel,
) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  if (
    !fs.existsSync(
      abs,
    )
  ) {
    throw new Error(
      `FILE_NOT_FOUND:${rel}`,
    );
  }

  return {
    rel,
    abs,
    text:
      fs.readFileSync(
        abs,
        "utf8",
      ),
  };
}

function backup(
  file,
) {
  fs.mkdirSync(
    BACKUP_DIR,
    {
      recursive:
        true,
    },
  );

  const target =
    path.join(
      BACKUP_DIR,
      file.rel
        .replaceAll(
          "/",
          "__",
        )
        .replaceAll(
          "\\",
          "__",
        ),
    );

  if (
    !fs.existsSync(
      target,
    )
  ) {
    fs.copyFileSync(
      file.abs,
      target,
    );
  }

  return target;
}

function replaceOnce(
  text,
  search,
  replacement,
  label,
) {
  const first =
    text.indexOf(
      search,
    );

  if (
    first <
    0
  ) {
    throw new Error(
      `ANCHOR_NOT_FOUND:${label}`,
    );
  }

  const second =
    text.indexOf(
      search,
      first +
        search.length,
    );

  if (
    second >=
    0
  ) {
    throw new Error(
      `ANCHOR_NOT_UNIQUE:${label}`,
    );
  }

  return (
    text.slice(
      0,
      first,
    ) +
    replacement +
    text.slice(
      first +
        search.length,
    )
  );
}

try {
  const kis =
    load(
      FILES.kis,
    );

  const buy =
    load(
      FILES.buy,
    );

  const sell =
    load(
      FILES.sell,
    );

  const backups = {
    kis:
      backup(
        kis,
      ),
    buy:
      backup(
        buy,
      ),
    sell:
      backup(
        sell,
      ),
  };

  let kisText =
    kis.text;

  let buyText =
    buy.text;

  let sellText =
    sell.text;

  /*
   * KIS read-only orderbook REST function.
   */
  if (
    !kisText.includes(
      "export async function getDomesticStockOrderbook(",
    )
  ) {
    const block = `

/* PAPER_EXECUTION_ORDERBOOK_V1_BEGIN */

export interface KisDomesticOrderbookOutput {
  askp1?: string | number | null;
  bidp1?: string | number | null;

  askp_rsqn1?: string | number | null;
  bidp_rsqn1?: string | number | null;

  [key: string]: unknown;
}

export interface KisDomesticOrderbookResponse {
  rt_cd?: string;
  msg_cd?: string;
  msg1?: string;

  output1?:
    | KisDomesticOrderbookOutput
    | null;

  output2?:
    | Record<string, unknown>
    | null;

  [key: string]: unknown;
}

/**
 * KIS domestic stock top-of-book snapshot.
 *
 * Official endpoint:
 * /uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn
 *
 * TR:
 * FHKST01010200
 *
 * Read-only market-data request. This does not place or alter orders.
 */
export async function getDomesticStockOrderbook(
  stockCode: string,
  accessToken: string,
): Promise<KisDomesticOrderbookResponse> {
  const {
    appKey,
    appSecret,
    baseUrl,
  } =
    getKisConfig();

  const normalizedStockCode =
    stockCode.trim();

  if (
    normalizedStockCode.length ===
    0
  ) {
    throw new Error(
      "INVALID_KIS_ORDERBOOK_STOCK_CODE",
    );
  }

  const params =
    new URLSearchParams({
      FID_COND_MRKT_DIV_CODE:
        "J",

      FID_INPUT_ISCD:
        normalizedStockCode,
    });

  const response =
    await fetch(
      \`\${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn?\${params}\`,
      {
        method:
          "GET",

        headers: {
          authorization:
            \`Bearer \${accessToken}\`,

          appkey:
            appKey,

          appsecret:
            appSecret,

          tr_id:
            "FHKST01010200",
        },

        cache:
          "no-store",
      },
    );

  const body =
    (await response.json()) as
      KisDomesticOrderbookResponse;

  if (
    !response.ok
  ) {
    throw new Error(
      \`KIS_ORDERBOOK_HTTP_\${response.status}:\${body.msg_cd ?? "UNKNOWN"}:\${body.msg1 ?? "UNKNOWN"}\`,
    );
  }

  if (
    body.rt_cd !==
      undefined &&
    body.rt_cd !==
      "0"
  ) {
    throw new Error(
      \`KIS_ORDERBOOK_API_ERROR:\${body.rt_cd}:\${body.msg_cd ?? "UNKNOWN"}:\${body.msg1 ?? "UNKNOWN"}\`,
    );
  }

  return body;
}

/* PAPER_EXECUTION_ORDERBOOK_V1_END */
`;

    kisText +=
      block;
  }

  const adapterImport =
    `import {
  resolvePaperExecutionRealismV2OrderbookQuote,
} from "@/lib/trading/resolve-paper-execution-realism-v2-orderbook-quote";`;

  /*
   * BUY binding.
   */
  if (
    !buyText.includes(
      "resolvePaperExecutionRealismV2OrderbookQuote",
    )
  ) {
    const marketImport =
      `import {
  resolvePaperExecutionRealismV2MarketInput,
} from "@/lib/trading/resolve-paper-execution-realism-v2-market-input";`;

    buyText =
      replaceOnce(
        buyText,
        marketImport,
        `${marketImport}
${adapterImport}`,
        "buy_market_input_import",
      );
  }

  if (
    !buyText.includes(
      "const orderbookQuote =",
    )
  ) {
    buyText =
      replaceOnce(
        buyText,
        `  const realismDecision =
    evaluatePaperExecutionRealismV2({`,
        `  const orderbookQuote =
    await resolvePaperExecutionRealismV2OrderbookQuote({
      stockCode:
        order.stock_code,
    });

  const realismDecision =
    evaluatePaperExecutionRealismV2({`,
        "buy_orderbook_resolve",
      );
  }

  if (
    !buyText.includes(
      "quote:\n        orderbookQuote.quote",
    )
  ) {
    buyText =
      replaceOnce(
        buyText,
        `      now:
        safeExecution.executionPriceObservedAt,
      intervalVolume:
        realismMarketInput.intervalVolume,`,
        `      now:
        orderbookQuote.quote?.observedAt ??
        safeExecution.executionPriceObservedAt,
      quote:
        orderbookQuote.quote,
      intervalVolume:
        realismMarketInput.intervalVolume,`,
        "buy_quote_argument",
      );
  }

  /*
   * Protective SELL binding.
   */
  if (
    !sellText.includes(
      "resolvePaperExecutionRealismV2OrderbookQuote",
    )
  ) {
    const marketImport =
      `import {
  resolvePaperExecutionRealismV2MarketInput,
} from "@/lib/trading/resolve-paper-execution-realism-v2-market-input";`;

    sellText =
      replaceOnce(
        sellText,
        marketImport,
        `${marketImport}
${adapterImport}`,
        "sell_market_input_import",
      );
  }

  if (
    !sellText.includes(
      "const orderbookQuote =",
    )
  ) {
    sellText =
      replaceOnce(
        sellText,
        `  let decision =
    evaluatePaperExecutionRealismV2({`,
        `  const orderbookQuote =
    await resolvePaperExecutionRealismV2OrderbookQuote({
      stockCode:
        input.stockCode,
    });

  let decision =
    evaluatePaperExecutionRealismV2({`,
        "sell_orderbook_resolve",
      );
  }

  if (
    (
      sellText.match(
        /quote:\s*orderbookQuote\.quote,/g,
      ) ??
      []
    ).length <
    2
  ) {
    sellText =
      sellText.replaceAll(
        `      now:
        input.observedAt,
      intervalVolume:`,
        `      now:
        orderbookQuote.quote?.observedAt ??
        input.observedAt,
      quote:
        orderbookQuote.quote,
      intervalVolume:`,
      );
  }

  const memoryChecks = {
    kisEndpoint:
      kisText.includes(
        "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
      ),

    kisTrId:
      kisText.includes(
        "FHKST01010200",
      ),

    buyBinding:
      buyText.includes(
        "const orderbookQuote =",
      ) &&
      buyText.includes(
        "quote:\n        orderbookQuote.quote",
      ),

    sellBinding:
      sellText.includes(
        "const orderbookQuote =",
      ) &&
      (
        sellText.match(
          /quote:\s*orderbookQuote\.quote,/g,
        ) ??
        []
      ).length >=
        2,

    noTradingEnable:
      !kisText.includes(
        "REAL_TRADING_ENABLED=true",
      ) &&
      !buyText.includes(
        "REAL_TRADING_ENABLED=true",
      ) &&
      !sellText.includes(
        "REAL_TRADING_ENABLED=true",
      ),
  };

  const failed =
    Object.entries(
      memoryChecks,
    )
      .filter(
        ([, ok]) =>
          ok !== true,
      )
      .map(
        ([name]) =>
          name,
      );

  if (
    failed.length >
    0
  ) {
    fail(
      "MEMORY_GUARD_FAILED",
      {
        memoryChecks,
        failed,
      },
    );

    return;
  }

  fs.writeFileSync(
    kis.abs,
    kisText,
    "utf8",
  );

  fs.writeFileSync(
    buy.abs,
    buyText,
    "utf8",
  );

  fs.writeFileSync(
    sell.abs,
    sellText,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_ORDERBOOK_BINDING_V1_PATCHED",

        changedFiles:
          Object.values(
            FILES,
          ),

        backups,

        implementation: {
          kisEndpoint:
            "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",

          trId:
            "FHKST01010200",

          buy:
            "best ask price/quantity supplied through quote",

          protectiveSell:
            "best bid price/quantity supplied through quote",

          fallback:
            "KIS read failure or empty book => quote null => existing synthetic spread fallback",
        },

        memoryChecks,

        safety: {
          sourceFilesWritten:
            3,
          databaseReads:
            0,
          databaseWrites:
            0,
          ordersCreated:
            0,
          ordersExecuted:
            0,
          positionsChanged:
            0,
          realTradingEnabled:
            false,
        },

        failed: [],

        nextGate:
          "RUN_CONTRACT_STATIC_AND_APP_TSC",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    0;
}
catch (
  error
) {
  fail(
    "PATCH_EXCEPTION",
    {
      error:
        String(
          error instanceof
            Error
            ? error.message
            : error,
        ),
    },
  );
}
