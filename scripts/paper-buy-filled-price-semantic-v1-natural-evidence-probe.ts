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

function toNumber(
  value: unknown,
): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const parsed =
      Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function nearlyEqual(
  left: number,
  right: number,
  tolerance = 0.000001,
) {
  const scale =
    Math.max(
      1,
      Math.abs(left),
      Math.abs(right),
    );

  return (
    Math.abs(
      left -
      right,
    ) <=
    tolerance *
    scale
  );
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
            "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_NATURAL_EVIDENCE_PROBE_FAIL",

          reason:
            "SUPABASE_SERVICE_ENV_NOT_FOUND",

          env: {
            urlEnvName:
              urlEnv.name,
            keyEnvName:
              keyEnv.name,
          },
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
          "approved_quantity",
          "filled_quantity",
          "entry_price",
          "filled_price",
          "execution_price",
          "execution_price_source",
          "execution_price_observed_at",
          "execution_fill_count",
          "execution_broker_fee",
          "execution_transaction_cost",
          "execution_risk_snapshot",
          "executed_at",
          "created_at",
        ].join(","),

      execution_fill_count:
        "gt.0",

      order:
        "executed_at.desc.nullslast,created_at.desc",

      limit:
        "100",
    });

  const endpoint =
    `${baseUrl}/rest/v1/paper_order_requests?${params.toString()}`;

  let response:
    Response;

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
            "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_NATURAL_EVIDENCE_PROBE_FAIL",

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

  const bodyText =
    await response.text();

  let rows:
    unknown =
      null;

  try {
    rows =
      JSON.parse(
        bodyText,
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
            "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_NATURAL_EVIDENCE_PROBE_FAIL",

          reason:
            "READ_RESPONSE_INVALID",

          httpStatus:
            response.status,

          responsePreview:
            bodyText.slice(
              0,
              600,
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

        const filledPrice =
          toNumber(
            row.filled_price,
          );

        const executionPrice =
          toNumber(
            row.execution_price,
          );

        const fillCount =
          toNumber(
            row.execution_fill_count,
          );

        const filledQuantity =
          toNumber(
            row.filled_quantity,
          );

        const riskSnapshot =
          isObject(
            row.execution_risk_snapshot,
          )
            ? row.execution_risk_snapshot
            : null;

        const provenanceVersion =
          riskSnapshot &&
          typeof riskSnapshot.executionProvenanceVersion ===
            "string"
            ? riskSnapshot.executionProvenanceVersion
            : null;

        const provenance =
          riskSnapshot &&
          isObject(
            riskSnapshot.executionProvenance,
          )
            ? riskSnapshot.executionProvenance
            : null;

        const isSingleFill =
          fillCount ===
          1;

        const isMultiFill =
          typeof fillCount ===
            "number" &&
          fillCount >
            1;

        const singleFillPriceMatches =
          isSingleFill &&
          filledPrice !==
            null &&
          executionPrice !==
            null &&
          nearlyEqual(
            filledPrice,
            executionPrice,
          );

        const checks = {
          hasPositiveFillCount:
            typeof fillCount ===
              "number" &&
            fillCount >
              0,

          hasPositiveFilledQuantity:
            typeof filledQuantity ===
              "number" &&
            filledQuantity >
              0,

          hasPositiveFilledPrice:
            typeof filledPrice ===
              "number" &&
            filledPrice >
              0,

          hasPositiveExecutionPrice:
            typeof executionPrice ===
              "number" &&
            executionPrice >
              0,

          provenanceVersionPresent:
            provenanceVersion ===
            "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1",

          provenanceObjectPresent:
            provenance !==
            null,

          singleFillPriceMatches:
            isSingleFill
              ? singleFillPriceMatches
              : null,
        };

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

          approvedQuantity:
            toNumber(
              row.approved_quantity,
            ),

          filledQuantity,
          fillCount,

          entryPrice:
            toNumber(
              row.entry_price,
            ),

          filledPrice,
          executionPrice,

          executionPriceSource:
            typeof row.execution_price_source ===
              "string"
              ? row.execution_price_source
              : null,

          observedAt:
            row.execution_price_observed_at ??
            null,

          executedAt:
            row.executed_at ??
            null,

          provenanceVersion,

          isSingleFill,
          isMultiFill,

          singleFillPriceMatches,

          checks,
        };
      },
    );

  const provenanceRows =
    inspected.filter(
      row =>
        row.provenanceVersion ===
        "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1",
    );

  const singleFillRows =
    provenanceRows.filter(
      row =>
        row.isSingleFill,
    );

  const singleFillPassRows =
    singleFillRows.filter(
      row =>
        row.singleFillPriceMatches,
    );

  const singleFillMismatchRows =
    singleFillRows.filter(
      row =>
        !row.singleFillPriceMatches,
    );

  const multiFillRows =
    provenanceRows.filter(
      row =>
        row.isMultiFill,
    );

  let status:
    string;

  let interpretation:
    string;

  if (
    singleFillMismatchRows.length >
    0
  ) {
    status =
      "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_NATURAL_EVIDENCE_FAIL";

    interpretation =
      "A natural single-fill PAPER BUY exists but persisted filled_price does not match execution_price. Review V4 runtime behavior.";
  }
  else if (
    singleFillPassRows.length >
    0
  ) {
    status =
      "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_NATURAL_EVIDENCE_PASS";

    interpretation =
      "At least one natural single-fill PAPER BUY proves V4 persisted actual execution price into filled_price.";
  }
  else if (
    multiFillRows.length >
    0
  ) {
    status =
      "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_NATURAL_EVIDENCE_MULTI_FILL_INCONCLUSIVE";

    interpretation =
      "Natural multi-fill PAPER BUY rows exist, but an order-level row alone cannot independently reconstruct every historical fill price. Do not mark this as failure; use a fill-ledger proof if needed.";
  }
  else {
    status =
      "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_NATURAL_EVIDENCE_WAIT";

    interpretation =
      inspected.length ===
        0
        ? "No natural PAPER BUY fills exist yet. This is a normal WAIT."
        : "Filled rows exist but no current V1 provenance row is available for semantic proof. This is a normal WAIT for a new natural V4 fill.";
  }

  console.log(
    JSON.stringify(
      {
        status,

        counts: {
          filledOrdersChecked:
            inspected.length,

          provenanceRows:
            provenanceRows.length,

          singleFillRows:
            singleFillRows.length,

          singleFillPassRows:
            singleFillPassRows.length,

          singleFillMismatchRows:
            singleFillMismatchRows.length,

          multiFillRows:
            multiFillRows.length,
        },

        evidence:
          singleFillPassRows.slice(
            0,
            10,
          ),

        mismatches:
          singleFillMismatchRows.slice(
            0,
            10,
          ),

        multiFillNeedsLedgerProof:
          multiFillRows.slice(
            0,
            10,
          ),

        recentRows:
          inspected.slice(
            0,
            20,
          ),

        interpretation,

        semanticContract: {
          firstFill:
            "filled_price must equal actual execution_price",

          laterPartialFill:
            "filled_price must equal cumulative quantity-weighted execution price",

          multiFillPolicy:
            "order-level state alone is not treated as sufficient independent proof of weighted-average reconstruction",
        },

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
          status.endsWith(
            "_PASS",
          )
            ? "PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_NATURAL_EVIDENCE_COMPLETE"
            : status.endsWith(
                "_FAIL",
              )
              ? "REVIEW_BUY_V4_RUNTIME_SEMANTIC"
              : status.endsWith(
                  "_MULTI_FILL_INCONCLUSIVE",
                )
                ? "OPTIONAL_BUILD_BUY_FILL_LEDGER_WEIGHTED_AVERAGE_PROOF"
                : "WAIT_FOR_NATURAL_PAPER_BUY_FILL",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    status.endsWith(
      "_FAIL",
    )
      ? 1
      : 0;
}

void main();
