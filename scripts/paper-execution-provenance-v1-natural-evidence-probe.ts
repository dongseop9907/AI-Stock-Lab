const VERSION =
  "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1";

const VALID_BUY_SOURCES =
  new Set([
    "BEST_ASK",
    "REFERENCE_PLUS_SYNTHETIC_SPREAD",
  ]);

function firstEnv(names: string[]) {
  for (const name of names) {
    const value =
      process.env[name]?.trim();

    if (value) {
      return {
        name,
        value,
      };
    }
  }

  return {
    name: null,
    value: null,
  };
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

async function main() {
  const urlEnv =
    firstEnv([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    ]);

  const keyEnv =
    firstEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
    ]);

  if (
    !urlEnv.value ||
    !keyEnv.value
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_PROBE_FAIL",
          reason:
            "SUPABASE_SERVICE_ENV_NOT_FOUND",
          env: {
            urlEnvName:
              urlEnv.name,
            keyEnvName:
              keyEnv.name,
          },
          secretsPrinted:
            false,
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  const baseUrl =
    urlEnv.value.replace(
      /\/+$/,
      "",
    );

  const params =
    new URLSearchParams({
      select:
        [
          "id",
          "stock_code",
          "status",
          "filled_quantity",
          "execution_fill_count",
          "execution_price",
          "execution_price_observed_at",
          "execution_price_source",
          "execution_risk_snapshot",
          "executed_at",
        ].join(","),
      execution_fill_count:
        "gt.0",
      order:
        "executed_at.desc.nullslast",
      limit:
        "100",
    });

  const endpoint =
    `${baseUrl}/rest/v1/paper_order_requests?${params.toString()}`;

  let response: Response;

  try {
    response =
      await fetch(
        endpoint,
        {
          method:
            "GET",
          headers: {
            apikey:
              keyEnv.value,
            Authorization:
              `Bearer ${keyEnv.value}`,
            Accept:
              "application/json",
            "Accept-Profile":
              "public",
          },
        },
      );
  }
  catch (error) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_PROBE_FAIL",
          reason:
            "READ_REQUEST_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            httpMethod:
              "GET",
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
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  const text =
    await response.text();

  let rows: unknown =
    null;

  try {
    rows =
      JSON.parse(text);
  }
  catch {
    rows =
      null;
  }

  if (
    !response.ok ||
    !Array.isArray(rows)
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_PROBE_FAIL",
          reason:
            "READ_RESPONSE_INVALID",
          httpStatus:
            response.status,
          responsePreview:
            text.slice(0, 500),
          safety: {
            httpMethod:
              "GET",
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
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  const inspected =
    rows.map(
      (
        raw,
        index,
      ) => {
        const row =
          isObject(raw)
            ? raw
            : {};

        const risk =
          isObject(
            row.execution_risk_snapshot,
          )
            ? row.execution_risk_snapshot
            : {};

        const provenance =
          isObject(
            risk.executionProvenance,
          )
            ? risk.executionProvenance
            : null;

        const version =
          typeof risk.executionProvenanceVersion ===
            "string"
            ? risk.executionProvenanceVersion
            : null;

        const source =
          typeof row.execution_price_source ===
            "string"
            ? row.execution_price_source
            : null;

        const execution =
          provenance &&
          isObject(
            provenance.execution,
          )
            ? provenance.execution
            : null;

        const orderbook =
          provenance &&
          isObject(
            provenance.orderbook,
          )
            ? provenance.orderbook
            : null;

        const hasCoreProvenance =
          version === VERSION &&
          provenance !== null &&
          VALID_BUY_SOURCES.has(
            source ?? "",
          ) &&
          execution !== null &&
          orderbook !== null;

        const hasPriceSourceMatch =
          execution &&
          typeof execution.priceSource ===
            "string"
            ? execution.priceSource ===
              source
            : false;

        const hasFilledQuantity =
          execution &&
          typeof execution.filledQuantity ===
            "number" &&
          execution.filledQuantity >
            0;

        const hasMarketImpact =
          execution &&
          typeof execution.marketImpactBps ===
            "number";

        const hasSyntheticSpread =
          execution &&
          typeof execution.syntheticSpreadBps ===
            "number";

        const hasOrderbookSource =
          orderbook &&
          typeof orderbook.source ===
            "string";

        const hasServerAgeField =
          orderbook
            ? Object.prototype.hasOwnProperty.call(
                orderbook,
                "serverQuoteAgeMs",
              )
            : false;

        const complete =
          hasCoreProvenance &&
          hasPriceSourceMatch &&
          hasFilledQuantity &&
          hasMarketImpact &&
          hasSyntheticSpread &&
          hasOrderbookSource &&
          hasServerAgeField;

        return {
          index,
          id:
            typeof row.id ===
              "string"
              ? row.id
              : null,
          stockCode:
            typeof row.stock_code ===
              "string"
              ? row.stock_code
              : null,
          status:
            typeof row.status ===
              "string"
              ? row.status
              : null,
          filledQuantity:
            row.filled_quantity ??
            null,
          executionFillCount:
            row.execution_fill_count ??
            null,
          executionPrice:
            row.execution_price ??
            null,
          executionPriceSource:
            source,
          executionObservedAt:
            row.execution_price_observed_at ??
            null,
          executedAt:
            row.executed_at ??
            null,
          provenanceVersion:
            version,
          hasCoreProvenance,
          hasPriceSourceMatch,
          hasFilledQuantity,
          hasMarketImpact,
          hasSyntheticSpread,
          hasOrderbookSource,
          hasServerAgeField,
          complete,
        };
      },
    );

  const completeRows =
    inspected.filter(
      row =>
        row.complete,
    );

  const v1Rows =
    inspected.filter(
      row =>
        row.provenanceVersion ===
        VERSION,
    );

  const status =
    completeRows.length >
      0
      ? "AI_STOCK_LAB_PAPER_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_PASS"
      : "AI_STOCK_LAB_PAPER_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_WAIT";

  console.log(
    JSON.stringify(
      {
        status,

        counts: {
          filledRowsChecked:
            inspected.length,
          v1ProvenanceRows:
            v1Rows.length,
          completeEvidenceRows:
            completeRows.length,
        },

        evidence:
          completeRows.slice(
            0,
            10,
          ),

        recentRows:
          inspected.slice(
            0,
            20,
          ),

        interpretation:
          completeRows.length >
            0
            ? "At least one natural PAPER fill persisted complete V1 execution provenance."
            : inspected.length ===
                0
              ? "No natural PAPER fills exist yet. This is a normal WAIT."
              : "Filled PAPER rows exist, but none yet contains complete V1 provenance. Legacy pre-V1 rows are not treated as failure.",

        safety: {
          readOnly:
            true,
          httpMethod:
            "GET",
          databaseReads:
            1,
          databaseWrites:
            0,
          rpcInvoked:
            false,
          ordersCreated:
            0,
          ordersExecuted:
            0,
          positionsChanged:
            0,
          realTradingEnabled:
            false,
          secretsPrinted:
            false,
        },

        nextGate:
          completeRows.length >
            0
            ? "PAPER_EXECUTION_PROVENANCE_V1_NATURAL_EVIDENCE_COMPLETE"
            : "WAIT_FOR_NATURAL_PAPER_FILL",
      },
      null,
      2,
    ),
  );

  // WAIT is expected/no-data, not a failure.
  process.exitCode = 0;
}

void main();
