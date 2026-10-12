import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  updateCanonicalShadowOutcomeEvaluation,
  type ShadowOutcomeEvaluationStatus,
} from "@/lib/models/model-shadow-outcome-storage";

export const MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_VERSION =
  "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1" as const;

type JsonRecord =
  Record<string, unknown>;

interface CanonicalPendingRow {
  signal_id: string;
  model_id: string;
  evaluation_status: string;
}

interface EntrySignalEvidenceRow {
  id: string;
  status: string;
  features: unknown;
  reasons: unknown;
  updated_at: string | null;
}

const STATUS_VALUES:
  readonly ShadowOutcomeEvaluationStatus[] = [
    "PENDING",
    "PARTIAL",
    "COMPLETED",
    "EXPIRED",
    "INVALID",
  ];

const ALIASES = {
  evaluationStatus: [
    "evaluation_status",
    "evaluationStatus",
  ],
  entryOpenPrice: [
    "entry_open_price",
    "entryOpenPrice",
  ],
  return1d: [
    "return_1d",
    "return1d",
  ],
  return3d: [
    "return_3d",
    "return3d",
  ],
  return5d: [
    "return_5d",
    "return5d",
  ],
  maxReturn1d: [
    "max_return_1d",
    "maxReturn1d",
  ],
  maxReturn3d: [
    "max_return_3d",
    "maxReturn3d",
  ],
  maxReturn5d: [
    "max_return_5d",
    "maxReturn5d",
  ],
  minReturn1d: [
    "min_return_1d",
    "minReturn1d",
  ],
  minReturn3d: [
    "min_return_3d",
    "minReturn3d",
  ],
  minReturn5d: [
    "min_return_5d",
    "minReturn5d",
  ],
  evaluated1dAt: [
    "evaluated_1d_at",
    "evaluated1dAt",
  ],
  evaluated3dAt: [
    "evaluated_3d_at",
    "evaluated3dAt",
  ],
  evaluated5dAt: [
    "evaluated_5d_at",
    "evaluated5dAt",
  ],
  evaluatedAt: [
    "evaluated_at",
    "evaluatedAt",
  ],
  expiresAt: [
    "expires_at",
    "expiresAt",
  ],
} as const;

function isRecord(
  value: unknown,
): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function collectRecords(
  value: unknown,
  output: JsonRecord[],
  seen: Set<object>,
  depth = 0,
) {
  if (
    depth > 8 ||
    value === null ||
    value === undefined
  ) {
    return;
  }

  if (
    typeof value === "object"
  ) {
    if (
      seen.has(
        value as object,
      )
    ) {
      return;
    }

    seen.add(
      value as object,
    );
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRecords(
        item,
        output,
        seen,
        depth + 1,
      );
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  output.push(value);

  for (
    const child of
    Object.values(value)
  ) {
    collectRecords(
      child,
      output,
      seen,
      depth + 1,
    );
  }
}

function findAliasValue(
  records: JsonRecord[],
  aliases: readonly string[],
): unknown {
  for (const record of records) {
    for (const alias of aliases) {
      if (
        Object.prototype
          .hasOwnProperty
          .call(
            record,
            alias,
          )
      ) {
        return record[alias];
      }
    }
  }

  return undefined;
}

function finiteNumberOrUndefined(
  value: unknown,
): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "number"
  ) {
    return Number.isFinite(value)
      ? value
      : undefined;
  }

  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    const parsed =
      Number(value);

    return Number.isFinite(parsed)
      ? parsed
      : undefined;
  }

  return undefined;
}

function stringOrUndefined(
  value: unknown,
): string | null | undefined {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "string" &&
    value.trim() !== ""
  ) {
    return value;
  }

  return undefined;
}

function canonicalStatusOrUndefined(
  value: unknown,
): ShadowOutcomeEvaluationStatus | undefined {
  if (
    typeof value !== "string"
  ) {
    return undefined;
  }

  const normalized =
    value
      .trim()
      .toUpperCase();

  return (
    STATUS_VALUES as
      readonly string[]
  ).includes(normalized)
    ? normalized as
        ShadowOutcomeEvaluationStatus
    : undefined;
}

function extractPersistedEvaluation(
  signal: EntrySignalEvidenceRow,
) {
  const records: JsonRecord[] = [];

  collectRecords(
    signal.features,
    records,
    new Set<object>(),
  );

  collectRecords(
    signal.reasons,
    records,
    new Set<object>(),
  );

  const evaluationStatus =
    canonicalStatusOrUndefined(
      findAliasValue(
        records,
        ALIASES.evaluationStatus,
      ),
    );

  if (!evaluationStatus) {
    return null;
  }

  return {
    evaluationStatus,

    entryOpenPrice:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.entryOpenPrice,
        ),
      ),

    return1d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.return1d,
        ),
      ),

    return3d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.return3d,
        ),
      ),

    return5d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.return5d,
        ),
      ),

    maxReturn1d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.maxReturn1d,
        ),
      ),

    maxReturn3d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.maxReturn3d,
        ),
      ),

    maxReturn5d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.maxReturn5d,
        ),
      ),

    minReturn1d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.minReturn1d,
        ),
      ),

    minReturn3d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.minReturn3d,
        ),
      ),

    minReturn5d:
      finiteNumberOrUndefined(
        findAliasValue(
          records,
          ALIASES.minReturn5d,
        ),
      ),

    evaluated1dAt:
      stringOrUndefined(
        findAliasValue(
          records,
          ALIASES.evaluated1dAt,
        ),
      ),

    evaluated3dAt:
      stringOrUndefined(
        findAliasValue(
          records,
          ALIASES.evaluated3dAt,
        ),
      ),

    evaluated5dAt:
      stringOrUndefined(
        findAliasValue(
          records,
          ALIASES.evaluated5dAt,
        ),
      ),

    evaluatedAt:
      stringOrUndefined(
        findAliasValue(
          records,
          ALIASES.evaluatedAt,
        ),
      ) ??
      signal.updated_at,

    expiresAt:
      stringOrUndefined(
        findAliasValue(
          records,
          ALIASES.expiresAt,
        ),
      ),
  };
}

export async function syncCanonicalShadowOutcomeFromEntrySignalsV1(
  input: {
    modelId?: string;
    limit?: number;
  } = {},
): Promise<{
  checked: number;
  updated: number;
  unresolved: number;
  skippedNonPending: number;
}> {
  const supabase =
    createSupabaseServerClient();

  const limit =
    Math.max(
      1,
      Math.min(
        1000,
        Math.trunc(
          input.limit ?? 500,
        ),
      ),
    );

  let query =
    supabase
      .from(
        "model_shadow_signal_outcomes",
      )
      .select(`
        signal_id,
        model_id,
        evaluation_status
      `)
      .in(
        "evaluation_status",
        [
          "PENDING",
          "PARTIAL",
        ],
      )
      .order(
        "created_at",
        {
          ascending: true,
        },
      )
      .limit(limit);

  if (input.modelId) {
    query =
      query.eq(
        "model_id",
        input.modelId,
      );
  }

  const {
    data: pendingRows,
    error: pendingError,
  } =
    await query;

  if (pendingError) {
    throw new Error(
      `SHADOW_CANONICAL_SYNC_PENDING_READ_FAILED:${pendingError.message}`,
    );
  }

  const rows =
    (
      pendingRows ??
      []
    ) as CanonicalPendingRow[];

  if (
    rows.length ===
      0
  ) {
    return {
      checked: 0,
      updated: 0,
      unresolved: 0,
      skippedNonPending: 0,
    };
  }

  const signalIds =
    rows.map(
      (row) =>
        row.signal_id,
    );

  const {
    data: signals,
    error: signalError,
  } =
    await supabase
      .from("ai_entry_signals")
      .select(`
        id,
        status,
        features,
        reasons,
        updated_at
      `)
      .in(
        "id",
        signalIds,
      );

  if (signalError) {
    throw new Error(
      `SHADOW_CANONICAL_SYNC_SIGNAL_READ_FAILED:${signalError.message}`,
    );
  }

  const byId =
    new Map(
      (
        signals ??
        []
      ).map(
        (row) => [
          row.id,
          row as EntrySignalEvidenceRow,
        ],
      ),
    );

  let updated = 0;
  let unresolved = 0;
  let skippedNonPending = 0;

  for (const row of rows) {
    if (
      row.evaluation_status !==
        "PENDING" &&
      row.evaluation_status !==
        "PARTIAL"
    ) {
      skippedNonPending += 1;
      continue;
    }

    const signal =
      byId.get(
        row.signal_id,
      );

    if (!signal) {
      unresolved += 1;
      continue;
    }

    const persisted =
      extractPersistedEvaluation(
        signal,
      );

    if (!persisted) {
      unresolved += 1;
      continue;
    }

    await updateCanonicalShadowOutcomeEvaluation({
      signalId:
        row.signal_id,
      ...persisted,
      evidence: {
        source:
          "AI_ENTRY_SIGNALS_PERSISTED_EVALUATION",
        canonicalSyncVersion:
          MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_VERSION,
        signalStatus:
          signal.status,
        noOutcomeRecalculation:
          true,
      },
    });

    updated += 1;
  }

  return {
    checked:
      rows.length,
    updated,
    unresolved,
    skippedNonPending,
  };
}
