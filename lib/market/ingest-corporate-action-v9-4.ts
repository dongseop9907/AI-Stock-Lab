import {
  createHash,
} from "crypto";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import type {
  CorporateActionInput,
  CorporateActionType,
} from "@/lib/market/corporate-action-provider-v9-4";

function requireDate(
  value:
    string,
  name:
    string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    throw new Error(
      `INVALID_${name}`,
    );
  }

  return value;
}

function clean(
  value:
    unknown,
) {
  return String(
    value ??
    "",
  ).trim();
}

function isSupportedSplit(
  actionType:
    CorporateActionType,
) {
  return (
    actionType ===
      "STOCK_SPLIT" ||
    actionType ===
      "REVERSE_SPLIT"
  );
}

export async function ingestCorporateActionV94(
  input:
    CorporateActionInput,
) {
  const supabase =
    createSupabaseServerClient();

  const stockCode =
    clean(
      input.stockCode,
    );

  const provider =
    clean(
      input.provider,
    );

  const effectiveDate =
    requireDate(
      input.effectiveDate,
      "EFFECTIVE_DATE",
    );

  if (
    !stockCode ||
    !provider
  ) {
    throw new Error(
      "V9_4_REQUIRED_METADATA_MISSING",
    );
  }

  const supported =
    isSupportedSplit(
      input.actionType,
    );

  if (
    supported &&
    (
      !Number.isFinite(
        input.ratioFrom,
      ) ||
      !Number.isFinite(
        input.ratioTo,
      ) ||
      Number(
        input.ratioFrom,
      ) <=
        0 ||
      Number(
        input.ratioTo,
      ) <=
        0
    )
  ) {
    throw new Error(
      "V9_4_INVALID_SPLIT_RATIO",
    );
  }

  const fingerprintPayload = {
    stockCode,
    actionType:
      input.actionType,
    effectiveDate,
    ratioFrom:
      input.ratioFrom ??
      null,
    ratioTo:
      input.ratioTo ??
      null,
    cashAmount:
      input.cashAmount ??
      null,
    currency:
      input.currency ??
      null,
    provider,
    providerEventId:
      input.providerEventId ??
      null,
  };

  const sourceFingerprint =
    createHash(
      "sha256",
    )
      .update(
        JSON.stringify(
          fingerprintPayload,
        ),
      )
      .digest(
        "hex",
      );

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "corporate_action_events",
      )
      .upsert(
        {
          stock_code:
            stockCode,

          action_type:
            input.actionType,

          effective_date:
            effectiveDate,

          ratio_from:
            input.ratioFrom ??
            null,

          ratio_to:
            input.ratioTo ??
            null,

          cash_amount:
            input.cashAmount ??
            null,

          currency:
            input.currency ??
            null,

          provider,

          provider_event_id:
            input.providerEventId ??
            null,

          source_fingerprint:
            sourceFingerprint,

          status:
            supported
              ? "SUPPORTED"
              : "UNSUPPORTED",

          metadata: {
            ...(
              input.metadata ??
              {}
            ),

            automaticAdjustmentApplied:
              false,

            supportedInV9_4:
              supported,
          },

          is_validation:
            input.isValidation ===
            true,

          production_applied:
            false,
        },
        {
          onConflict:
            "stock_code,action_type,effective_date,provider,source_fingerprint,is_validation",
        },
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
        is_validation,
        production_applied
      `)
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `v9.4 corporate-action ingest failed: ${
        error?.message ??
        "NO_EVENT"
      }`,
    );
  }

  return {
    version:
      "CORPORATE_ACTION_INGESTION_V9_4",

    event:
      data,

    adjustmentPolicy: {
      supportedForDeterministicAdjustment:
        supported,

      rawBarsModified:
        false,

      automaticProductionUse:
        false,
    },
  };
}
