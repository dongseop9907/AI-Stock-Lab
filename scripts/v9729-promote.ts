import {
  createSupabaseServerClient,
} from "../lib/supabase";

const VERSION =
  "V9_7_29_PRODUCTION_CANONICAL_PROMOTION";

const PROVIDER =
  "DART_KRX_CANONICAL";

interface CorporateActionRow {
  id: string;
  stock_code: string;
  action_type: string;
  effective_date: string;
  ratio_from: number | string | null;
  ratio_to: number | string | null;
  cash_amount: number | string | null;
  currency: string | null;
  provider: string;
  provider_event_id: string;
  source_fingerprint: string;
  status: string;
  metadata: Record<string, unknown> | null;
  is_validation: boolean;
  production_applied: boolean;
}

function stableNumber(
  value:
    | number
    | string
    | null,
) {
  if (
    value ===
    null
  ) {
    return null;
  }

  const n =
    Number(
      value,
    );

  if (
    !Number.isFinite(
      n,
    )
  ) {
    throw new Error(
      "INVALID_NUMERIC_VALUE",
    );
  }

  return n;
}

function canonicalCore(
  row:
    CorporateActionRow,
) {
  return {
    stock_code:
      row.stock_code,

    action_type:
      row.action_type,

    effective_date:
      row.effective_date,

    ratio_from:
      stableNumber(
        row.ratio_from,
      ),

    ratio_to:
      stableNumber(
        row.ratio_to,
      ),

    cash_amount:
      stableNumber(
        row.cash_amount,
      ),

    currency:
      row.currency,

    provider:
      row.provider,

    provider_event_id:
      row.provider_event_id,

    source_fingerprint:
      row.source_fingerprint,
  };
}

function sameCore(
  a:
    CorporateActionRow,
  b:
    CorporateActionRow,
) {
  return (
    JSON.stringify(
      canonicalCore(
        a,
      ),
    ) ===
    JSON.stringify(
      canonicalCore(
        b,
      ),
    )
  );
}

function isValidatedCanonical(
  row:
    CorporateActionRow,
) {
  return (
    row.is_validation ===
      true &&
    row.provider ===
      PROVIDER &&
    row.metadata
      ?.canonical_validation_status ===
      "VALIDATED"
  );
}

function productionPayload(
  row:
    CorporateActionRow,
) {
  return {
    stock_code:
      row.stock_code,

    action_type:
      row.action_type,

    effective_date:
      row.effective_date,

    ratio_from:
      row.ratio_from,

    ratio_to:
      row.ratio_to,

    cash_amount:
      row.cash_amount,

    currency:
      row.currency,

    provider:
      row.provider,

    provider_event_id:
      row.provider_event_id,

    source_fingerprint:
      row.source_fingerprint,

    /*
     * Preserve the already-proven DB lifecycle value.
     * Canonical validity remains explicit in metadata.
     */
    status:
      "RECORDED",

    metadata: {
      ...(
        row.metadata ??
        {}
      ),

      canonical_validation_status:
        "VALIDATED",

      production_promotion_version:
        VERSION,

      promoted_from_validation_event_id:
        row.id,
    },

    is_validation:
      false,

    /*
     * This field must remain false.
     * Price-history refresh is handled independently by the
     * EOD stale-history mechanism.
     */
    production_applied:
      false,
  };
}

async function readRows(
  isValidation:
    boolean,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "corporate_action_events",
      )
      .select(`
        id,
        stock_code,
        action_type,
        effective_date,
        ratio_from,
        ratio_to,
        cash_amount,
        currency,
        provider,
        provider_event_id,
        source_fingerprint,
        status,
        metadata,
        is_validation,
        production_applied
      `)
      .eq(
        "provider",
        PROVIDER,
      )
      .eq(
        "is_validation",
        isValidation,
      )
      .order(
        "effective_date",
        {
          ascending:
            true,
        },
      )
      .order(
        "stock_code",
        {
          ascending:
            true,
        },
      );

  if (
    error
  ) {
    throw new Error(
      `CORPORATE_ACTION_READ_FAILED: ${error.message}`,
    );
  }

  return (
    data ??
    []
  ) as CorporateActionRow[];
}

async function main() {
  const apply =
    process.argv
      .slice(2)
      .includes(
        "--apply",
      );

  const unknownArgs =
    process.argv
      .slice(2)
      .filter(
        (arg) =>
          arg !==
          "--apply",
      );

  if (
    unknownArgs.length >
    0
  ) {
    throw new Error(
      "UNKNOWN_OPTION",
    );
  }

  const validationRows =
    await readRows(
      true,
    );

  const eligible =
    validationRows.filter(
      isValidatedCanonical,
    );

  const validationIdentityMap =
    new Map<
      string,
      CorporateActionRow
    >();

  for (
    const row of
    eligible
  ) {
    const key =
      row.provider_event_id;

    if (
      validationIdentityMap.has(
        key,
      )
    ) {
      throw new Error(
        `DUPLICATE_VALIDATION_PROVIDER_EVENT_ID:${key}`,
      );
    }

    validationIdentityMap.set(
      key,
      row,
    );
  }

  const productionBefore =
    await readRows(
      false,
    );

  const productionMapBefore =
    new Map(
      productionBefore.map(
        (row) => [
          row.provider_event_id,
          row,
        ],
      ),
    );

  const exactExistingBefore:
    string[] =
    [];

  const conflictsBefore:
    Array<{
      providerEventId:
        string;
      validationCore:
        ReturnType<
          typeof canonicalCore
        >;
      productionCore:
        ReturnType<
          typeof canonicalCore
        >;
    }> =
    [];

  const missingBefore:
    string[] =
    [];

  for (
    const row of
    eligible
  ) {
    const existing =
      productionMapBefore.get(
        row.provider_event_id,
      );

    if (
      !existing
    ) {
      missingBefore.push(
        row.provider_event_id,
      );

      continue;
    }

    if (
      sameCore(
        row,
        existing,
      )
    ) {
      exactExistingBefore.push(
        row.provider_event_id,
      );
    } else {
      conflictsBefore.push({
        providerEventId:
          row.provider_event_id,

        validationCore:
          canonicalCore(
            row,
          ),

        productionCore:
          canonicalCore(
            existing,
          ),
      });
    }
  }

  const preview = {
    validationCanonicalRows:
      validationRows.length,

    eligibleValidatedRows:
      eligible.length,

    productionRowsBefore:
      productionBefore.length,

    exactExistingBefore:
      exactExistingBefore.length,

    missingBefore:
      missingBefore.length,

    conflictsBefore:
      conflictsBefore.length,

    providerIdentityDuplicatesInValidation:
      validationRows.length -
      new Set(
        validationRows.map(
          (row) =>
            row.provider_event_id,
        ),
      ).size,

    eligibleActionTypeCounts:
      Object.fromEntries(
        Object.entries(
          eligible.reduce(
            (
              acc,
              row,
            ) => {
              acc[
                row.action_type
              ] =
                (
                  acc[
                    row.action_type
                  ] ??
                  0
                ) +
                1;

              return acc;
            },
            {} as Record<
              string,
              number
            >,
          ),
        ),
      ),
  };

  if (
    conflictsBefore.length >
    0
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "V9_7_29_PRODUCTION_PROMOTION_BLOCKED_BY_CONFLICT",

          applyRequested:
            apply,

          preview,

          conflictsBefore,

          writesPerformed:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;

    return;
  }

  if (
    eligible.length ===
    0
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "V9_7_29_NO_ELIGIBLE_VALIDATED_CANONICAL_EVENTS",

          applyRequested:
            apply,

          preview,

          writesPerformed:
            0,
        },
        null,
        2,
      ),
    );

    return;
  }

  if (
    !apply
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "V9_7_29_PRODUCTION_PROMOTION_DRY_RUN_READY",

          applyRequested:
            false,

          preview,

          wouldUpsert:
            eligible.length,

          policy: {
            source:
              "VALIDATED_CANONICAL_ROWS_ONLY",

            provider:
              PROVIDER,

            productionIsValidation:
              false,

            productionApplied:
              false,

            validationRowsPreserved:
              true,

            identity:
              "provider,provider_event_id,is_validation",

            factorMutation:
              false,
          },

          writesPerformed:
            0,

          nextCommand:
            "npx tsx --env-file=.env.local .\\scripts\\v9729-promote.ts --apply",
        },
        null,
        2,
      ),
    );

    return;
  }

  const supabase =
    createSupabaseServerClient();

  const payload =
    eligible.map(
      productionPayload,
    );

  const {
    data: firstUpsert,
    error:
      firstUpsertError,
  } =
    await supabase
      .from(
        "corporate_action_events",
      )
      .upsert(
        payload,
        {
          onConflict:
            "provider,provider_event_id,is_validation",
        },
      )
      .select(
        "id,provider,provider_event_id,is_validation",
      );

  if (
    firstUpsertError
  ) {
    throw new Error(
      `FIRST_PRODUCTION_UPSERT_FAILED: ${firstUpsertError.message}`,
    );
  }

  const afterFirst =
    await readRows(
      false,
    );

  const afterFirstMap =
    new Map(
      afterFirst.map(
        (row) => [
          row.provider_event_id,
          row,
        ],
      ),
    );

  const mismatchesAfterFirst =
    eligible.filter(
      (row) => {
        const production =
          afterFirstMap.get(
            row.provider_event_id,
          );

        return (
          !production ||
          !sameCore(
            row,
            production,
          ) ||
          production.is_validation !==
            false ||
          production.production_applied !==
            false
        );
      },
    );

  if (
    mismatchesAfterFirst.length >
    0
  ) {
    throw new Error(
      `POST_FIRST_UPSERT_MISMATCH:${mismatchesAfterFirst.length}`,
    );
  }

  /*
   * Second identical upsert proves idempotency.
   */
  const {
    data: secondUpsert,
    error:
      secondUpsertError,
  } =
    await supabase
      .from(
        "corporate_action_events",
      )
      .upsert(
        payload,
        {
          onConflict:
            "provider,provider_event_id,is_validation",
        },
      )
      .select(
        "id,provider,provider_event_id,is_validation",
      );

  if (
    secondUpsertError
  ) {
    throw new Error(
      `SECOND_PRODUCTION_UPSERT_FAILED: ${secondUpsertError.message}`,
    );
  }

  const afterSecond =
    await readRows(
      false,
    );

  const productionRelevant =
    afterSecond.filter(
      (row) =>
        validationIdentityMap.has(
          row.provider_event_id,
        ),
    );

  const duplicateGroups =
    Object.entries(
      productionRelevant.reduce(
        (
          acc,
          row,
        ) => {
          acc[
            row.provider_event_id
          ] =
            (
              acc[
                row.provider_event_id
              ] ??
              0
            ) +
            1;

          return acc;
        },
        {} as Record<
          string,
          number
        >,
      ),
    ).filter(
      (
        [, count],
      ) =>
        count >
        1,
    );

  const afterSecondMap =
    new Map(
      productionRelevant.map(
        (row) => [
          row.provider_event_id,
          row,
        ],
      ),
    );

  const mismatchesAfterSecond =
    eligible.filter(
      (row) => {
        const production =
          afterSecondMap.get(
            row.provider_event_id,
          );

        return (
          !production ||
          !sameCore(
            row,
            production,
          ) ||
          production.is_validation !==
            false ||
          production.production_applied !==
            false
        );
      },
    );

  const idempotencyProven =
    mismatchesAfterSecond.length ===
      0 &&
    duplicateGroups.length ===
      0 &&
    productionRelevant.length ===
      eligible.length;

  console.log(
    JSON.stringify(
      {
        status:
          idempotencyProven
            ? "V9_7_29_PRODUCTION_PROMOTION_AND_IDEMPOTENCY_PROVEN"
            : "V9_7_29_PRODUCTION_PROMOTION_REVIEW_REQUIRED",

        applyRequested:
          true,

        preview,

        firstUpsertResponseRows:
          firstUpsert?.length ??
          0,

        productionRelevantAfterFirst:
          eligible.length,

        mismatchesAfterFirst:
          mismatchesAfterFirst.length,

        secondUpsertResponseRows:
          secondUpsert?.length ??
          0,

        productionRelevantAfterSecond:
          productionRelevant.length,

        providerIdentityDuplicateGroupsAfterSecond:
          duplicateGroups.length,

        mismatchesAfterSecond:
          mismatchesAfterSecond.length,

        idempotencyProven,

        validationRowsPreserved:
          true,

        allProductionRowsIsValidationFalse:
          productionRelevant.every(
            (row) =>
              row.is_validation ===
              false,
          ),

        allProductionAppliedFalse:
          productionRelevant.every(
            (row) =>
              row.production_applied ===
              false,
          ),

        writesPerformed:
          2,

        nextCommand:
          "npx tsx --env-file=.env.local .\\scripts\\v9728-preflight.ts",
      },
      null,
      2,
    ),
  );

  if (
    !idempotencyProven
  ) {
    process.exitCode =
      3;
  }
}

main().catch(
  (error) => {
    console.error(
      error instanceof Error
        ? error.message
        : error,
    );

    process.exitCode =
      1;
  },
);
