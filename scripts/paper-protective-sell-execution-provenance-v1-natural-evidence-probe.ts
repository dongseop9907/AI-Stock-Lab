const VERSION =
  "PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1";

const VALID_SOURCES =
  new Set([
    "BEST_BID",
    "REFERENCE_MINUS_SYNTHETIC_SPREAD",
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
            "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_PROBE_FAIL",

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
          "position_id",
          "account_id",
          "stock_code",
          "requested_quantity",
          "filled_quantity",
          "remaining_quantity",
          "execution_price",
          "broker_fee",
          "sell_tax",
          "total_transaction_cost",
          "execution_source",
          "exit_reason",
          "observed_at",
          "created_at",
          "execution_provenance",
          "execution_provenance_version",
        ].join(","),

      order:
        "created_at.desc",

      limit:
        "100",
    });

  const endpoint =
    `${baseUrl}/rest/v1/paper_protective_execution_fills_v2?${params.toString()}`;

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
            "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_PROBE_FAIL",

          reason:
            "READ_REQUEST_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            readOnly:
              true,

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
      JSON.parse(
        text,
      );
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
            "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_PROBE_FAIL",

          reason:
            "READ_RESPONSE_INVALID",

          httpStatus:
            response.status,

          responsePreview:
            text.slice(
              0,
              500,
            ),

          safety: {
            readOnly:
              true,

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

        const provenance =
          isObject(
            row.execution_provenance,
          )
            ? row.execution_provenance
            : null;

        const execution =
          provenance &&
          isObject(
            provenance.execution,
          )
            ? provenance.execution
            : null;

        const protective =
          provenance &&
          isObject(
            provenance.protective,
          )
            ? provenance.protective
            : null;

        const marketInput =
          provenance &&
          isObject(
            provenance.marketInput,
          )
            ? provenance.marketInput
            : null;

        const orderbook =
          provenance &&
          isObject(
            provenance.orderbook,
          )
            ? provenance.orderbook
            : null;

        const version =
          typeof row.execution_provenance_version ===
            "string"
            ? row.execution_provenance_version
            : null;

        const source =
          typeof row.execution_source ===
            "string"
            ? row.execution_source
            : null;

        const exitReason =
          typeof row.exit_reason ===
            "string"
            ? row.exit_reason
            : null;

        const executionPriceSource =
          execution &&
          typeof execution.priceSource ===
            "string"
            ? execution.priceSource
            : null;

        const checks = {
          correctVersion:
            version ===
            VERSION,

          validExecutionSource:
            VALID_SOURCES.has(
              source ?? "",
            ),

          provenanceObject:
            provenance !==
            null,

          sourceMatchesPayload:
            executionPriceSource !==
              null &&
            executionPriceSource ===
              source,

          positiveFilledQuantity:
            typeof row.filled_quantity ===
              "number" &&
            row.filled_quantity >
              0,

          executionMetricsPresent:
            execution !==
              null &&
            typeof execution.marketImpactBps ===
              "number" &&
            typeof execution.syntheticSpreadBps ===
              "number" &&
            Object.prototype.hasOwnProperty.call(
              execution,
              "topOfBookQuantityCap",
            ) &&
            Object.prototype.hasOwnProperty.call(
              execution,
              "quoteAgeMs",
            ),

          protectiveContextPresent:
            protective !==
            null,

          marketInputPresent:
            marketInput !==
            null,

          orderbookPresent:
            orderbook !==
            null,

          exitReasonValid:
            exitReason ===
              "STOP_LOSS" ||
            exitReason ===
              "TRAILING_STOP" ||
            (
              provenance !==
                null &&
              (
                provenance.exitReason ===
                  "STOP_LOSS" ||
                provenance.exitReason ===
                  "TRAILING_STOP"
              )
            ),
        };

        const complete =
          Object.values(
            checks,
          ).every(Boolean);

        return {
          index,

          id:
            typeof row.id ===
              "string"
              ? row.id
              : null,

          positionId:
            typeof row.position_id ===
              "string"
              ? row.position_id
              : null,

          stockCode:
            typeof row.stock_code ===
              "string"
              ? row.stock_code
              : null,

          requestedQuantity:
            row.requested_quantity ??
            null,

          filledQuantity:
            row.filled_quantity ??
            null,

          remainingQuantity:
            row.remaining_quantity ??
            null,

          executionPrice:
            row.execution_price ??
            null,

          executionSource:
            source,

          exitReason,

          observedAt:
            row.observed_at ??
            null,

          createdAt:
            row.created_at ??
            null,

          provenanceVersion:
            version,

          checks,

          complete,
        };
      },
    );

  const v1Rows =
    inspected.filter(
      row =>
        row.provenanceVersion ===
        VERSION,
    );

  const completeRows =
    inspected.filter(
      row =>
        row.complete,
    );

  const status =
    completeRows.length >
      0
      ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_PASS"
      : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_NATURAL_EVIDENCE_WAIT";

  console.log(
    JSON.stringify(
      {
        status,

        counts: {
          protectiveFillRowsChecked:
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
            ? "At least one natural protective PAPER SELL fill persisted complete V1 execution provenance."
            : inspected.length ===
                0
              ? "No natural protective PAPER SELL fills exist yet. This is a normal WAIT."
              : v1Rows.length ===
                  0
                ? "Protective SELL fills exist, but only legacy pre-V1 rows are present. This is a normal WAIT for a new V1 natural fill."
                : "V1 rows exist but no row satisfies the full evidence contract. Review the reported row-level checks.",

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
            ? "PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_NATURAL_EVIDENCE_COMPLETE"
            : "WAIT_FOR_NATURAL_PROTECTIVE_PAPER_SELL_FILL",
      },
      null,
      2,
    ),
  );

  /*
   * No natural evidence is an expected WAIT, not a failing test.
   */
  process.exitCode = 0;
}

void main();
