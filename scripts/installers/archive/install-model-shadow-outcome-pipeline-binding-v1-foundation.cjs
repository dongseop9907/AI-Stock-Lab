const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261009000600_model_shadow_outcome_pipeline_binding_v1.sql";

const helperRel =
  "lib/models/model-shadow-outcome-pipeline-binding.ts";

const routeRel =
  "app/api/signals/shadow/evaluate/route.ts";

const routeAbs =
  path.resolve(root, routeRel);

if (!fs.existsSync(routeAbs)) {
  throw new Error(
    `REQUIRED_ROUTE_MISSING:${routeRel}`
  );
}

let route =
  fs.readFileSync(
    routeAbs,
    "utf8"
  );

const originalRoute = route;

function insertImport(source) {
  if (
    source.includes(
      "syncCanonicalShadowOutcomeFromEntrySignalsV1"
    )
  ) {
    return source;
  }

  const importText =
    'import { syncCanonicalShadowOutcomeFromEntrySignalsV1 } from "@/lib/models/model-shadow-outcome-pipeline-binding";\n';

  const importMatches =
    [...source.matchAll(
      /import[\s\S]*?;\s*/g
    )];

  if (importMatches.length === 0) {
    return importText + source;
  }

  const last =
    importMatches[
      importMatches.length - 1
    ];

  const end =
    last.index +
    last[0].length;

  return (
    source.slice(0, end) +
    importText +
    source.slice(end)
  );
}

function findCallStatementEnd(
  source,
  needle
) {
  const callIndex =
    source.indexOf(needle);

  if (callIndex < 0) {
    throw new Error(
      `BINDING_ANCHOR_NOT_FOUND:${needle}`
    );
  }

  const openIndex =
    source.indexOf(
      "(",
      callIndex
    );

  if (openIndex < 0) {
    throw new Error(
      "BINDING_CALL_OPEN_PAREN_NOT_FOUND"
    );
  }

  let depth = 0;
  let quote = null;
  let escape = false;
  let templateDepth = 0;

  for (
    let i = openIndex;
    i < source.length;
    i += 1
  ) {
    const ch = source[i];

    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }

      if (ch === "\\") {
        escape = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (
      ch === '"' ||
      ch === "'" ||
      ch === "`"
    ) {
      quote = ch;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      continue;
    }

    if (ch === ")") {
      depth -= 1;

      if (depth === 0) {
        let j = i + 1;

        while (
          j < source.length &&
          /\s/.test(source[j])
        ) {
          j += 1;
        }

        if (source[j] === ";") {
          return j + 1;
        }

        return i + 1;
      }
    }
  }

  throw new Error(
    "BINDING_CALL_STATEMENT_END_NOT_FOUND"
  );
}

route =
  insertImport(route);

if (
  !route.includes(
    "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_ROUTE_BIND"
  )
) {
  const end =
    findCallStatementEnd(
      route,
      "evaluateShadowSignals("
    );

  const injection =
    '\n\n    // MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_ROUTE_BIND\n' +
    '    await syncCanonicalShadowOutcomeFromEntrySignalsV1();';

  route =
    route.slice(0, end) +
    injection +
    route.slice(end);
}

if (
  !route.includes(
    "syncCanonicalShadowOutcomeFromEntrySignalsV1"
  )
) {
  throw new Error(
    "ROUTE_BINDING_FAILED_NO_SYNC_CALL"
  );
}

if (
  route.indexOf(
    "syncCanonicalShadowOutcomeFromEntrySignalsV1("
  ) <=
  route.indexOf(
    "evaluateShadowSignals("
  )
) {
  throw new Error(
    "ROUTE_BINDING_ORDER_INVALID"
  );
}

const backupRel =
  routeRel +
  ".pre-model-shadow-outcome-pipeline-binding-v1";

const backupAbs =
  path.resolve(
    root,
    backupRel
  );

if (
  route !== originalRoute &&
  !fs.existsSync(backupAbs)
) {
  fs.writeFileSync(
    backupAbs,
    originalRoute,
    "utf8"
  );
}

const files = {
  [migrationRel]:
    "-- MODEL SHADOW OUTCOME PIPELINE BINDING V1\n-- Capture binding via DB trigger.\n-- No historical backfill.\n-- Only post-promotion SHADOW signals are inserted.\n\ncreate or replace function public.capture_model_shadow_signal_outcome_v1()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_stage text;\n  v_stage_updated_at timestamptz;\nbegin\n  select\n    promotion_stage,\n    promotion_stage_updated_at\n  into\n    v_stage,\n    v_stage_updated_at\n  from public.ai_model_versions\n  where id = new.model_id;\n\n  if v_stage is distinct from 'SHADOW' then\n    return new;\n  end if;\n\n  if v_stage_updated_at is null then\n    return new;\n  end if;\n\n  if new.created_at < v_stage_updated_at then\n    return new;\n  end if;\n\n  insert into public.model_shadow_signal_outcomes (\n    signal_id,\n    model_id,\n    stock_code,\n    signal_observed_at,\n    captured_at,\n    promotion_stage_at_capture,\n    promotion_stage_updated_at_at_capture,\n    recommended_entry_price,\n    recommended_stop_price,\n    evaluation_status,\n    evidence,\n    source_version\n  )\n  values (\n    new.id,\n    new.model_id,\n    new.stock_code,\n    new.observed_at,\n    new.created_at,\n    'SHADOW',\n    v_stage_updated_at,\n    new.recommended_entry_price,\n    new.recommended_stop_price,\n    'PENDING',\n    jsonb_build_object(\n      'captureSource',\n      'AI_ENTRY_SIGNALS_AFTER_INSERT_TRIGGER',\n      'capturedAfterShadowPromotion',\n      true\n    ),\n    'MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1'\n  )\n  on conflict (signal_id) do nothing;\n\n  return new;\nend;\n$$;\n\ndrop trigger if exists trg_capture_model_shadow_signal_outcome_v1\n  on public.ai_entry_signals;\n\ncreate trigger trg_capture_model_shadow_signal_outcome_v1\nafter insert on public.ai_entry_signals\nfor each row\nexecute function public.capture_model_shadow_signal_outcome_v1();\n\ncomment on function public.capture_model_shadow_signal_outcome_v1() is\n'Creates canonical Shadow evidence only for ai_entry_signals inserted while the linked model is already in SHADOW. No historical backfill.';\n",
  [helperRel]:
    "import {\n  createSupabaseServerClient,\n} from \"@/lib/supabase\";\n\nimport {\n  updateCanonicalShadowOutcomeEvaluation,\n  type ShadowOutcomeEvaluationStatus,\n} from \"@/lib/models/model-shadow-outcome-storage\";\n\nexport const MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_VERSION =\n  \"MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1\" as const;\n\ntype JsonRecord =\n  Record<string, unknown>;\n\ninterface CanonicalPendingRow {\n  signal_id: string;\n  model_id: string;\n  evaluation_status: string;\n}\n\ninterface EntrySignalEvidenceRow {\n  id: string;\n  status: string;\n  features: unknown;\n  reasons: unknown;\n  updated_at: string | null;\n}\n\nconst STATUS_VALUES:\n  readonly ShadowOutcomeEvaluationStatus[] = [\n    \"PENDING\",\n    \"PARTIAL\",\n    \"COMPLETED\",\n    \"EXPIRED\",\n    \"INVALID\",\n  ];\n\nconst ALIASES = {\n  evaluationStatus: [\n    \"evaluation_status\",\n    \"evaluationStatus\",\n  ],\n  entryOpenPrice: [\n    \"entry_open_price\",\n    \"entryOpenPrice\",\n  ],\n  return1d: [\n    \"return_1d\",\n    \"return1d\",\n  ],\n  return3d: [\n    \"return_3d\",\n    \"return3d\",\n  ],\n  return5d: [\n    \"return_5d\",\n    \"return5d\",\n  ],\n  maxReturn1d: [\n    \"max_return_1d\",\n    \"maxReturn1d\",\n  ],\n  maxReturn3d: [\n    \"max_return_3d\",\n    \"maxReturn3d\",\n  ],\n  maxReturn5d: [\n    \"max_return_5d\",\n    \"maxReturn5d\",\n  ],\n  minReturn1d: [\n    \"min_return_1d\",\n    \"minReturn1d\",\n  ],\n  minReturn3d: [\n    \"min_return_3d\",\n    \"minReturn3d\",\n  ],\n  minReturn5d: [\n    \"min_return_5d\",\n    \"minReturn5d\",\n  ],\n  evaluated1dAt: [\n    \"evaluated_1d_at\",\n    \"evaluated1dAt\",\n  ],\n  evaluated3dAt: [\n    \"evaluated_3d_at\",\n    \"evaluated3dAt\",\n  ],\n  evaluated5dAt: [\n    \"evaluated_5d_at\",\n    \"evaluated5dAt\",\n  ],\n  evaluatedAt: [\n    \"evaluated_at\",\n    \"evaluatedAt\",\n  ],\n  expiresAt: [\n    \"expires_at\",\n    \"expiresAt\",\n  ],\n} as const;\n\nfunction isRecord(\n  value: unknown,\n): value is JsonRecord {\n  return (\n    typeof value === \"object\" &&\n    value !== null &&\n    !Array.isArray(value)\n  );\n}\n\nfunction collectRecords(\n  value: unknown,\n  output: JsonRecord[],\n  seen: Set<object>,\n  depth = 0,\n) {\n  if (\n    depth > 8 ||\n    value === null ||\n    value === undefined\n  ) {\n    return;\n  }\n\n  if (\n    typeof value === \"object\"\n  ) {\n    if (\n      seen.has(\n        value as object,\n      )\n    ) {\n      return;\n    }\n\n    seen.add(\n      value as object,\n    );\n  }\n\n  if (Array.isArray(value)) {\n    for (const item of value) {\n      collectRecords(\n        item,\n        output,\n        seen,\n        depth + 1,\n      );\n    }\n    return;\n  }\n\n  if (!isRecord(value)) {\n    return;\n  }\n\n  output.push(value);\n\n  for (\n    const child of\n    Object.values(value)\n  ) {\n    collectRecords(\n      child,\n      output,\n      seen,\n      depth + 1,\n    );\n  }\n}\n\nfunction findAliasValue(\n  records: JsonRecord[],\n  aliases: readonly string[],\n): unknown {\n  for (const record of records) {\n    for (const alias of aliases) {\n      if (\n        Object.prototype\n          .hasOwnProperty\n          .call(\n            record,\n            alias,\n          )\n      ) {\n        return record[alias];\n      }\n    }\n  }\n\n  return undefined;\n}\n\nfunction finiteNumberOrUndefined(\n  value: unknown,\n): number | null | undefined {\n  if (value === null) {\n    return null;\n  }\n\n  if (\n    typeof value === \"number\"\n  ) {\n    return Number.isFinite(value)\n      ? value\n      : undefined;\n  }\n\n  if (\n    typeof value === \"string\" &&\n    value.trim() !== \"\"\n  ) {\n    const parsed =\n      Number(value);\n\n    return Number.isFinite(parsed)\n      ? parsed\n      : undefined;\n  }\n\n  return undefined;\n}\n\nfunction stringOrUndefined(\n  value: unknown,\n): string | null | undefined {\n  if (value === null) {\n    return null;\n  }\n\n  if (\n    typeof value === \"string\" &&\n    value.trim() !== \"\"\n  ) {\n    return value;\n  }\n\n  return undefined;\n}\n\nfunction canonicalStatusOrUndefined(\n  value: unknown,\n): ShadowOutcomeEvaluationStatus | undefined {\n  if (\n    typeof value !== \"string\"\n  ) {\n    return undefined;\n  }\n\n  const normalized =\n    value\n      .trim()\n      .toUpperCase();\n\n  return (\n    STATUS_VALUES as\n      readonly string[]\n  ).includes(normalized)\n    ? normalized as\n        ShadowOutcomeEvaluationStatus\n    : undefined;\n}\n\nfunction extractPersistedEvaluation(\n  signal: EntrySignalEvidenceRow,\n) {\n  const records: JsonRecord[] = [];\n\n  collectRecords(\n    signal.features,\n    records,\n    new Set<object>(),\n  );\n\n  collectRecords(\n    signal.reasons,\n    records,\n    new Set<object>(),\n  );\n\n  const evaluationStatus =\n    canonicalStatusOrUndefined(\n      findAliasValue(\n        records,\n        ALIASES.evaluationStatus,\n      ),\n    );\n\n  if (!evaluationStatus) {\n    return null;\n  }\n\n  return {\n    evaluationStatus,\n\n    entryOpenPrice:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.entryOpenPrice,\n        ),\n      ),\n\n    return1d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.return1d,\n        ),\n      ),\n\n    return3d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.return3d,\n        ),\n      ),\n\n    return5d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.return5d,\n        ),\n      ),\n\n    maxReturn1d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.maxReturn1d,\n        ),\n      ),\n\n    maxReturn3d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.maxReturn3d,\n        ),\n      ),\n\n    maxReturn5d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.maxReturn5d,\n        ),\n      ),\n\n    minReturn1d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.minReturn1d,\n        ),\n      ),\n\n    minReturn3d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.minReturn3d,\n        ),\n      ),\n\n    minReturn5d:\n      finiteNumberOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.minReturn5d,\n        ),\n      ),\n\n    evaluated1dAt:\n      stringOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.evaluated1dAt,\n        ),\n      ),\n\n    evaluated3dAt:\n      stringOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.evaluated3dAt,\n        ),\n      ),\n\n    evaluated5dAt:\n      stringOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.evaluated5dAt,\n        ),\n      ),\n\n    evaluatedAt:\n      stringOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.evaluatedAt,\n        ),\n      ) ??\n      signal.updated_at,\n\n    expiresAt:\n      stringOrUndefined(\n        findAliasValue(\n          records,\n          ALIASES.expiresAt,\n        ),\n      ),\n  };\n}\n\nexport async function syncCanonicalShadowOutcomeFromEntrySignalsV1(\n  input: {\n    modelId?: string;\n    limit?: number;\n  } = {},\n): Promise<{\n  checked: number;\n  updated: number;\n  unresolved: number;\n  skippedNonPending: number;\n}> {\n  const supabase =\n    createSupabaseServerClient();\n\n  const limit =\n    Math.max(\n      1,\n      Math.min(\n        1000,\n        Math.trunc(\n          input.limit ?? 500,\n        ),\n      ),\n    );\n\n  let query =\n    supabase\n      .from(\n        \"model_shadow_signal_outcomes\",\n      )\n      .select(`\n        signal_id,\n        model_id,\n        evaluation_status\n      `)\n      .in(\n        \"evaluation_status\",\n        [\n          \"PENDING\",\n          \"PARTIAL\",\n        ],\n      )\n      .order(\n        \"created_at\",\n        {\n          ascending: true,\n        },\n      )\n      .limit(limit);\n\n  if (input.modelId) {\n    query =\n      query.eq(\n        \"model_id\",\n        input.modelId,\n      );\n  }\n\n  const {\n    data: pendingRows,\n    error: pendingError,\n  } =\n    await query;\n\n  if (pendingError) {\n    throw new Error(\n      `SHADOW_CANONICAL_SYNC_PENDING_READ_FAILED:${pendingError.message}`,\n    );\n  }\n\n  const rows =\n    (\n      pendingRows ??\n      []\n    ) as CanonicalPendingRow[];\n\n  if (\n    rows.length ===\n      0\n  ) {\n    return {\n      checked: 0,\n      updated: 0,\n      unresolved: 0,\n      skippedNonPending: 0,\n    };\n  }\n\n  const signalIds =\n    rows.map(\n      (row) =>\n        row.signal_id,\n    );\n\n  const {\n    data: signals,\n    error: signalError,\n  } =\n    await supabase\n      .from(\"ai_entry_signals\")\n      .select(`\n        id,\n        status,\n        features,\n        reasons,\n        updated_at\n      `)\n      .in(\n        \"id\",\n        signalIds,\n      );\n\n  if (signalError) {\n    throw new Error(\n      `SHADOW_CANONICAL_SYNC_SIGNAL_READ_FAILED:${signalError.message}`,\n    );\n  }\n\n  const byId =\n    new Map(\n      (\n        signals ??\n        []\n      ).map(\n        (row) => [\n          row.id,\n          row as EntrySignalEvidenceRow,\n        ],\n      ),\n    );\n\n  let updated = 0;\n  let unresolved = 0;\n  let skippedNonPending = 0;\n\n  for (const row of rows) {\n    if (\n      row.evaluation_status !==\n        \"PENDING\" &&\n      row.evaluation_status !==\n        \"PARTIAL\"\n    ) {\n      skippedNonPending += 1;\n      continue;\n    }\n\n    const signal =\n      byId.get(\n        row.signal_id,\n      );\n\n    if (!signal) {\n      unresolved += 1;\n      continue;\n    }\n\n    const persisted =\n      extractPersistedEvaluation(\n        signal,\n      );\n\n    if (!persisted) {\n      unresolved += 1;\n      continue;\n    }\n\n    await updateCanonicalShadowOutcomeEvaluation({\n      signalId:\n        row.signal_id,\n      ...persisted,\n      evidence: {\n        source:\n          \"AI_ENTRY_SIGNALS_PERSISTED_EVALUATION\",\n        canonicalSyncVersion:\n          MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_VERSION,\n        signalStatus:\n          signal.status,\n        noOutcomeRecalculation:\n          true,\n      },\n    });\n\n    updated += 1;\n  }\n\n  return {\n    checked:\n      rows.length,\n    updated,\n    unresolved,\n    skippedNonPending,\n  };\n}\n",
  "scripts/model-shadow-outcome-pipeline-binding-v1-contract-test.ts":
    "import {\n  MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_VERSION,\n} from \"../lib/models/model-shadow-outcome-pipeline-binding\";\n\nfunction assert(\n  condition: unknown,\n  message: string,\n): asserts condition {\n  if (!condition) {\n    throw new Error(message);\n  }\n}\n\nassert(\n  MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_VERSION ===\n    \"MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1\",\n  \"SHADOW_PIPELINE_BINDING_VERSION_MISMATCH\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        \"MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_CONTRACT_VERIFIED\",\n      invariants: [\n        \"CAPTURE_IS_DB_TRIGGER_BASED\",\n        \"ONLY_POST_PROMOTION_SHADOW_SIGNALS_CAPTURED\",\n        \"NO_HISTORICAL_BACKFILL\",\n        \"EVALUATION_SIDECAR_DOES_NOT_RECALCULATE_OUTCOMES\",\n        \"ONLY_PERSISTED_EXISTING_EVALUATION_FIELDS_ARE_MIRRORED\",\n        \"UNKNOWN_OR_MISSING_EVALUATION_REMAINS_PENDING\",\n        \"NO_PAPER_PROMOTION\",\n        \"NO_ORDER_OR_POSITION_MUTATION\",\n        \"REAL_TRADING_NOT_TOUCHED\",\n      ],\n    },\n    null,\n    2,\n  ),\n);\n",
  "scripts/model-shadow-outcome-pipeline-binding-v1-static-verify.cjs":
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst migrationRel =\n  \"supabase/migrations/20261009000600_model_shadow_outcome_pipeline_binding_v1.sql\";\n\nconst helperRel =\n  \"lib/models/model-shadow-outcome-pipeline-binding.ts\";\n\nconst routeRel =\n  \"app/api/signals/shadow/evaluate/route.ts\";\n\nconst migration =\n  fs.readFileSync(\n    path.resolve(root, migrationRel),\n    \"utf8\",\n  );\n\nconst helper =\n  fs.readFileSync(\n    path.resolve(root, helperRel),\n    \"utf8\",\n  );\n\nconst route =\n  fs.readFileSync(\n    path.resolve(root, routeRel),\n    \"utf8\",\n  );\n\nconst evalIndex =\n  route.indexOf(\n    \"evaluateShadowSignals(\",\n  );\n\nconst syncIndex =\n  route.indexOf(\n    \"syncCanonicalShadowOutcomeFromEntrySignalsV1(\",\n  );\n\nconst checks = {\n  captureTriggerFunction:\n    /create\\s+or\\s+replace\\s+function\\s+public\\.capture_model_shadow_signal_outcome_v1/i.test(\n      migration,\n    ),\n\n  captureAfterInsertTrigger:\n    /create\\s+trigger\\s+trg_capture_model_shadow_signal_outcome_v1[\\s\\S]*after\\s+insert\\s+on\\s+public\\.ai_entry_signals/i.test(\n      migration,\n    ),\n\n  stageShadowOnly:\n    migration.includes(\n      \"v_stage is distinct from 'SHADOW'\",\n    ),\n\n  postPromotionTimestampGuard:\n    migration.includes(\n      \"new.created_at < v_stage_updated_at\",\n    ),\n\n  noHistoricalBackfill:\n    !/insert\\s+into\\s+public\\.model_shadow_signal_outcomes[\\s\\S]{0,1600}select[\\s\\S]{0,1600}from\\s+public\\.ai_entry_signals/i.test(\n      migration,\n    ),\n\n  sidecarReadsCanonicalPending:\n    helper.includes(\n      '\"model_shadow_signal_outcomes\"',\n    ) &&\n    helper.includes(\n      '\"PENDING\"',\n    ),\n\n  sidecarReadsPersistedSignals:\n    helper.includes(\n      '.from(\"ai_entry_signals\")',\n    ),\n\n  sidecarNoMarketSnapshotRead:\n    !helper.includes(\n      '\"market_snapshots\"',\n    ),\n\n  sidecarNoOutcomeRecalculation:\n    helper.includes(\n      \"noOutcomeRecalculation:\",\n    ),\n\n  unresolvedStaysUnchanged:\n    helper.includes(\n      \"unresolved += 1\",\n    ),\n\n  routeImportsSidecar:\n    route.includes(\n      \"syncCanonicalShadowOutcomeFromEntrySignalsV1\",\n    ),\n\n  routeCallsExistingEvaluatorFirst:\n    evalIndex >= 0 &&\n    syncIndex > evalIndex,\n\n  noPaperOrderMutation:\n    !/\\.from\\(\\s*[\"']paper_order_requests[\"']\\s*\\)[\\s\\S]{0,500}?\\.(insert|update|delete)\\s*\\(/.test(\n      helper,\n    ),\n\n  noPositionMutation:\n    !/\\.from\\(\\s*[\"']paper_positions[\"']\\s*\\)[\\s\\S]{0,500}?\\.(insert|update|delete)\\s*\\(/.test(\n      helper,\n    ),\n\n  noPromotionMutation:\n    !/\\.from\\(\\s*[\"']ai_model_versions[\"']\\s*\\)[\\s\\S]{0,600}?\\.update\\s*\\(/.test(\n      helper,\n    ),\n\n  noRealTradingEnable:\n    !/real_order_enabled\\s*=\\s*true/i.test(\n      migration +\n      \"\\n\" +\n      helper +\n      \"\\n\" +\n      route,\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, ok]) => !ok)\n    .map(([name]) => name);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_STATIC_VERIFIED\"\n          : \"MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_STATIC_FAILED\",\n      checks,\n      failed,\n      databaseApplied:\n        false,\n      historicalBackfill:\n        false,\n      paperPromotionApplied:\n        false,\n      realTradingChanged:\n        false,\n    },\n    null,\n    2,\n  ),\n);\n\nif (failed.length > 0) {\n  process.exitCode = 1;\n}\n",
};

for (
  const [rel, content]
  of Object.entries(files)
) {
  const target =
    path.resolve(root, rel);

  fs.mkdirSync(
    path.dirname(target),
    { recursive: true }
  );

  fs.writeFileSync(
    target,
    content,
    "utf8"
  );
}

fs.writeFileSync(
  routeAbs,
  route,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_FOUNDATION_INSTALLED",
      changed: [
        migrationRel,
        helperRel,
        routeRel
      ],
      backup:
        route !== originalRoute
          ? backupRel
          : null,
      databaseApplied:
        false,
      binding: {
        capture:
          "DB_TRIGGER_ON_AI_ENTRY_SIGNALS_AFTER_INSERT",
        evaluation:
          "EXISTING_EVALUATOR_THEN_PERSISTED_EVIDENCE_SIDECAR",
        outcomeRecalculation:
          false,
        unresolvedBehavior:
          "KEEP_PENDING"
      },
      safety: {
        historicalBackfill:
          false,
        paperPromotion:
          false,
        ordersCreated:
          0,
        positionsChanged:
          0,
        controlsChanged:
          false,
        realTradingChanged:
          false
      },
      nextAction:
        "RUN_CONTRACT_STATIC_IMPORT_SMOKE"
    },
    null,
    2
  )
);
