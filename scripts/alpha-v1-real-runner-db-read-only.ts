import fs from "node:fs";
import path from "node:path";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  rankAlphaCandidates,
  type AlphaTrack,
} from "../lib/alpha/candidate-scoring";

import {
  buildAlphaCandidateInputFromRealSources,
  type DisclosurePredictionGate,
  type MarketRegimeShadow,
  type MarketSnapshotLike,
} from "../lib/alpha/feature-adapters";

import {
  buildEventPersistenceEvidence,
  type PredictionHistoryLike,
} from "../lib/alpha/confirmed-source-adapters";

const VERSION =
  "ALPHA_V1_REAL_RUNNER_DB_READ_ONLY";

const MAX_SNAPSHOT_ROWS = 5000;
const MAX_PREDICTION_ROWS = 5000;
const PREDICTION_FRESH_MINUTES = 180;

type JsonRecord =
  Record<string, unknown>;

interface ActiveStock {
  stock_code: string;
  stock_name?: string | null;
  market?: string | null;
  sector?: string | null;
}

interface RunnerConfig {
  decisionAt: string;
  track: AlphaTrack;
}

function asString(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text
    ? text
    : null;
}

function asNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function asBoolean(
  value: unknown,
): boolean | null {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    const normalized =
      value
        .trim()
        .toLowerCase();

    if (
      normalized === "true"
    ) {
      return true;
    }

    if (
      normalized === "false"
    ) {
      return false;
    }
  }

  return null;
}

function normalizeStockCode(
  value: unknown,
): string | null {
  const text =
    asString(value);

  if (!text) {
    return null;
  }

  const digits =
    text.replace(
      /\D/g,
      "",
    );

  if (!digits) {
    return null;
  }

  return digits
    .padStart(6, "0")
    .slice(-6);
}

function parseTime(
  value: unknown,
): number | null {
  const text =
    asString(value);

  if (!text) {
    return null;
  }

  const parsed =
    new Date(text).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function isoOrNull(
  value: unknown,
): string | null {
  const time =
    parseTime(value);

  return time === null
    ? null
    : new Date(time)
        .toISOString();
}

function resolvePredictionTimestamp(
  row: JsonRecord,
): string | null {
  const direct = [
    row.generated_at,
    row.generatedAt,
    row.created_at,
    row.createdAt,
    row.updated_at,
    row.updatedAt,
  ];

  for (const value of direct) {
    const iso =
      isoOrNull(value);

    if (iso) {
      return iso;
    }
  }

  const predictionDate =
    asString(
      row.prediction_date ??
      row.predictionDate,
    );

  if (
    predictionDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      predictionDate,
    )
  ) {
    return `${predictionDate}T00:00:00.000Z`;
  }

  return null;
}

function normalizePredictionRow(
  row: JsonRecord,
): PredictionHistoryLike | null {
  const stockCode =
    normalizeStockCode(
      row.stock_code ??
      row.stockCode,
    );

  if (!stockCode) {
    return null;
  }

  return {
    stock_code:
      stockCode,

    score:
      asNumber(row.score),

    direction:
      asString(
        row.direction,
      ),

    confidence:
      asNumber(
        row.confidence,
      ),

    is_candidate:
      asBoolean(
        row.is_candidate ??
        row.isCandidate,
      ),

    generated_at:
      resolvePredictionTimestamp(
        row,
      ),

    prediction_date:
      asString(
        row.prediction_date ??
        row.predictionDate,
      ),

    created_at:
      isoOrNull(
        row.created_at ??
        row.createdAt,
      ),

    model_name:
      asString(
        row.model_name ??
        row.modelName,
      ),

    model_version:
      asString(
        row.model_version ??
        row.modelVersion,
      ),
  };
}

function buildPredictionGate(
  stockCode: string,
  rows: PredictionHistoryLike[],
  decisionAt: string,
): DisclosurePredictionGate | null {
  const decisionAtMs =
    new Date(
      decisionAt,
    ).getTime();

  const usable =
    rows
      .filter(
        (row) =>
          row.stock_code ===
          stockCode,
      )
      .map(
        (row) => ({
          row,
          availableAt:
            row.generated_at ??
            row.created_at ??
            (
              row.prediction_date
                ? `${row.prediction_date}T00:00:00.000Z`
                : null
            ),
        }),
      )
      .map(
        (item) => ({
          ...item,
          availableAtMs:
            item.availableAt
              ? new Date(
                  item.availableAt,
                ).getTime()
              : Number.NaN,
        }),
      )
      .filter(
        (item) =>
          Number.isFinite(
            item.availableAtMs,
          ) &&
          item.availableAtMs <=
            decisionAtMs,
      )
      .sort(
        (a, b) =>
          b.availableAtMs -
          a.availableAtMs,
      );

  const latest =
    usable[0];

  if (
    !latest ||
    !latest.availableAt
  ) {
    return null;
  }

  const ageMinutes =
    Math.max(
      0,
      (
        decisionAtMs -
        latest.availableAtMs
      ) /
      60_000,
    );

  const fresh =
    ageMinutes <=
    PREDICTION_FRESH_MINUTES;

  return {
    available:
      true,

    fresh,

    predictionDate:
      latest.row
        .prediction_date ??
      latest.availableAt
        .slice(0, 10),

    generatedAt:
      latest.availableAt,

    modelName:
      latest.row
        .model_name ??
      "DISCLOSURE_PRICE_RULE",

    modelVersion:
      latest.row
        .model_version ??
      null,

    ageMinutes,

    maximumAgeMinutes:
      PREDICTION_FRESH_MINUTES,

    candidateCount:
      latest.row.is_candidate ===
      true
        ? 1
        : 0,

    stockCodes:
      latest.row.is_candidate ===
      true
        ? [stockCode]
        : [],

    /**
     * Alpha wants the latest prediction evidence for every stock,
     * not only upstream rows already marked as candidate.
     */
    candidates: [
      {
        stock_code:
          stockCode,

        score:
          Number(
            latest.row.score ??
            0.5,
          ),

        direction:
          latest.row.direction,

        confidence:
          Number(
            latest.row.confidence ??
            0.5,
          ),

        is_candidate:
          latest.row.is_candidate ??
          false,
      },
    ],

    reason:
      fresh
        ? "LATEST_PREDICTION_AVAILABLE"
        : "LATEST_PREDICTION_STALE",
  };
}

function normalizeSnapshotRows(
  rows: JsonRecord[],
): MarketSnapshotLike[] {
  return rows
    .map(
      (row) => {
        const stockCode =
          normalizeStockCode(
            row.stock_code ??
            row.stockCode,
          );

        const observedAt =
          isoOrNull(
            row.observed_at ??
            row.observedAt,
          );

        if (
          !stockCode ||
          !observedAt
        ) {
          return null;
        }

        return {
          stock_code:
            stockCode,

          observed_at:
            observedAt,

          close_price:
            asNumber(
              row.close_price ??
              row.closePrice,
            ),

          open_price:
            asNumber(
              row.open_price ??
              row.openPrice,
            ),

          high_price:
            asNumber(
              row.high_price ??
              row.highPrice,
            ),

          low_price:
            asNumber(
              row.low_price ??
              row.lowPrice,
            ),

          volume:
            asNumber(
              row.volume,
            ),
        } satisfies MarketSnapshotLike;
      },
    )
    .filter(
      (
        row,
      ): row is MarketSnapshotLike =>
        row !== null,
    );
}

function computeMarketRegimeProxy(
  snapshots: MarketSnapshotLike[],
  activeStockCodes: string[],
): MarketRegimeShadow | null {
  const grouped =
    new Map<
      string,
      MarketSnapshotLike[]
    >();

  for (const row of snapshots) {
    if (
      !activeStockCodes.includes(
        row.stock_code,
      )
    ) {
      continue;
    }

    const current =
      grouped.get(
        row.stock_code,
      ) ?? [];

    current.push(row);

    grouped.set(
      row.stock_code,
      current,
    );
  }

  const returns: Array<{
    stockCode: string;
    value: number;
    latestObservedAt: string;
  }> = [];

  for (
    const [
      stockCode,
      rows,
    ]
    of grouped.entries()
  ) {
    const sorted =
      [...rows].sort(
        (a, b) =>
          new Date(
            b.observed_at,
          ).getTime() -
          new Date(
            a.observed_at,
          ).getTime(),
      );

    if (
      sorted.length < 2
    ) {
      continue;
    }

    const latestClose =
      asNumber(
        sorted[0]
          .close_price,
      );

    const referenceIndex =
      Math.min(
        19,
        sorted.length - 1,
      );

    const referenceClose =
      asNumber(
        sorted[
          referenceIndex
        ].close_price,
      );

    if (
      latestClose === null ||
      referenceClose === null ||
      latestClose <= 0 ||
      referenceClose <= 0
    ) {
      continue;
    }

    returns.push({
      stockCode,

      value:
        (
          latestClose -
          referenceClose
        ) /
        referenceClose,

      latestObservedAt:
        sorted[0]
          .observed_at,
    });
  }

  if (
    returns.length === 0
  ) {
    return null;
  }

  const positive =
    returns.filter(
      (row) =>
        row.value > 0,
    ).length;

  const breadth20 =
    positive /
    returns.length;

  const avgReturn20 =
    returns.reduce(
      (sum, row) =>
        sum +
        row.value,
      0,
    ) /
    returns.length;

  const regime =
    breadth20 >= 0.60 &&
    avgReturn20 >= 0.02
      ? "BULL"
      : breadth20 <= 0.40 ||
          avgReturn20 <= -0.03
        ? "BEAR"
        : "NEUTRAL";

  const latestObservedAt =
    returns
      .map(
        (row) =>
          row.latestObservedAt,
      )
      .sort()
      .at(-1) ??
    null;

  if (!latestObservedAt) {
    return null;
  }

  return {
    mode:
      "SHADOW",

    appliedToOrders:
      false,

    regime,

    wouldBlockByRegime:
      regime === "BEAR",

    breadth20,
    avgReturn20,

    sampleSize:
      activeStockCodes.length,

    returnSampleSize:
      returns.length,

    stockCodes:
      returns.map(
        (row) =>
          row.stockCode,
      ),

    latestMarketDate:
      latestObservedAt
        .slice(0, 10),

    latestSnapshotObservedAt:
      latestObservedAt,

    /**
     * Use underlying data availability time, not runner execution time.
     * This keeps stale-data protection intact.
     */
    observedAt:
      latestObservedAt,

    source:
      "ALPHA_ACTIVE_SNAPSHOT_PROXY_V1",

    reason:
      "READ_ONLY_ALPHA_REGIME_DIAGNOSTIC",
  };
}

function resolveSupabaseConfig() {
  const url =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL ??
    process.env
      .SUPABASE_URL;

  const serviceKey =
    process.env
      .SUPABASE_SERVICE_ROLE_KEY ??
    process.env
      .SUPABASE_SERVICE_KEY;

  const anonKey =
    process.env
      .NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env
      .SUPABASE_ANON_KEY;

  const key =
    serviceKey ??
    anonKey;

  if (!url) {
    throw new Error(
      "SUPABASE_URL_ENV_MISSING",
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_KEY_ENV_MISSING",
    );
  }

  return {
    url,
    key,
    authMode:
      serviceKey
        ? "SERVICE_ROLE"
        : "ANON",
  };
}

async function readActiveStocks(
  supabase: SupabaseClient,
): Promise<{
  stocks: ActiveStock[];
  warning: string | null;
}> {
  const result =
    await supabase
      .from("stocks")
      .select(
        "stock_code,stock_name,market,sector,is_active",
      )
      .eq(
        "is_active",
        true,
      )
      .order(
        "stock_code",
        {
          ascending: true,
        },
      )
      .limit(1000);

  if (result.error) {
    return {
      stocks: [],
      warning:
        `STOCKS_READ_FAILED:${result.error.message}`,
    };
  }

  const stocks =
    (
      result.data ??
      []
    )
      .map(
        (
          row:
          Record<string, unknown>,
        ) => {
          const stockCode =
            normalizeStockCode(
              row.stock_code,
            );

          if (!stockCode) {
            return null;
          }

          return {
            stock_code:
              stockCode,

            stock_name:
              asString(
                row.stock_name,
              ),

            market:
              asString(
                row.market,
              ),

            sector:
              asString(
                row.sector,
              ),
          } satisfies ActiveStock;
        },
      )
      .filter(
        (
          row,
        ): row is ActiveStock =>
          row !== null,
      );

  return {
    stocks,
    warning:
      null,
  };
}

async function readSnapshots(
  supabase: SupabaseClient,
  stockCodes: string[],
) {
  let query =
    supabase
      .from(
        "market_snapshots",
      )
      .select(
        "stock_code,observed_at,close_price,open_price,high_price,low_price,volume",
      )
      .order(
        "observed_at",
        {
          ascending: false,
        },
      )
      .limit(
        MAX_SNAPSHOT_ROWS,
      );

  if (
    stockCodes.length > 0
  ) {
    query =
      query.in(
        "stock_code",
        stockCodes,
      );
  }

  const result =
    await query;

  if (result.error) {
    throw new Error(
      `MARKET_SNAPSHOTS_READ_FAILED:${result.error.message}`,
    );
  }

  return normalizeSnapshotRows(
    (
      result.data ??
      []
    ) as JsonRecord[],
  );
}

async function readPredictions(
  supabase: SupabaseClient,
  stockCodes: string[],
) {
  let query =
    supabase
      .from(
        "ai_stock_predictions",
      )
      .select("*")
      .limit(
        MAX_PREDICTION_ROWS,
      );

  if (
    stockCodes.length > 0
  ) {
    query =
      query.in(
        "stock_code",
        stockCodes,
      );
  }

  const result =
    await query;

  if (result.error) {
    throw new Error(
      `AI_STOCK_PREDICTIONS_READ_FAILED:${result.error.message}`,
    );
  }

  const rawRows =
    (
      result.data ??
      []
    ) as JsonRecord[];

  const normalized =
    rawRows
      .map(
        normalizePredictionRow,
      )
      .filter(
        (
          row,
        ): row is PredictionHistoryLike =>
          row !== null,
      );

  return {
    rawRows,
    normalized,
  };
}

function inferStockCodes(
  stocks: ActiveStock[],
  snapshots: MarketSnapshotLike[],
  predictions: PredictionHistoryLike[],
): string[] {
  const codes =
    new Set<string>();

  for (const stock of stocks) {
    codes.add(
      stock.stock_code,
    );
  }

  for (const row of snapshots) {
    codes.add(
      row.stock_code,
    );
  }

  for (const row of predictions) {
    codes.add(
      row.stock_code,
    );
  }

  return [
    ...codes,
  ].sort();
}

function printCompact(
  value: unknown,
) {
  console.log(
    JSON.stringify(
      value,
      null,
      2,
    ),
  );
}

async function main() {
  const config:
    RunnerConfig = {
      decisionAt:
        new Date()
          .toISOString(),

      track:
        (
          String(
            process.env
              .ALPHA_TRACK ??
            "STABLE",
          )
            .trim()
            .toUpperCase() ===
          "AGGRESSIVE"
        )
          ? "AGGRESSIVE"
          : "STABLE",
    };

  const supabaseConfig =
    resolveSupabaseConfig();

  const supabase =
    createClient(
      supabaseConfig.url,
      supabaseConfig.key,
      {
        auth: {
          persistSession:
            false,

          autoRefreshToken:
            false,
        },
      },
    );

  const warnings:
    string[] = [];

  const stockResult =
    await readActiveStocks(
      supabase,
    );

  if (
    stockResult.warning
  ) {
    warnings.push(
      stockResult.warning,
    );
  }

  const initialCodes =
    stockResult.stocks.map(
      (row) =>
        row.stock_code,
    );

  const snapshots =
    await readSnapshots(
      supabase,
      initialCodes,
    );

  const predictionResult =
    await readPredictions(
      supabase,
      initialCodes,
    );

  const stockCodes =
    inferStockCodes(
      stockResult.stocks,
      snapshots,
      predictionResult.normalized,
    );

  const regime =
    computeMarketRegimeProxy(
      snapshots,
      stockCodes,
    );

  const inputs =
    stockCodes.map(
      (stockCode) => {
        const gate =
          buildPredictionGate(
            stockCode,
            predictionResult.normalized,
            config.decisionAt,
          );

        const eventPersistence =
          buildEventPersistenceEvidence({
            stockCode,

            decisionAt:
              config.decisionAt,

            predictions:
              predictionResult.normalized,

            lookbackHours:
              72,
          });

        const candidateInput =
          buildAlphaCandidateInputFromRealSources({
            stockCode,

            decisionAt:
              config.decisionAt,

          disclosurePredictionGate:
            gate,

          marketRegimeShadow:
            regime,

          marketSnapshots:
            snapshots,

          eventPersistenceEvidence:
            eventPersistence,

          /**
           * No confirmed investor flow source yet.
           */
          flowEvidence:
            undefined,

          /**
           * Risk validation requires a concrete proposed entry/stop/size
           * and portfolio state. Do not fabricate it in candidate ranking.
           */
          riskEvidence:
            undefined,

          modelVersion:
            "alpha-v1-real-runner-readonly",
          });

        candidateInput.riskPolicy =
          "DEFER_TO_PREFLIGHT";

        return candidateInput;
      },
    );

  const ranking =
    rankAlphaCandidates(
      inputs,
      config.track,
    );

  const stockMap =
    new Map(
      stockResult.stocks.map(
        (row) => [
          row.stock_code,
          row,
        ],
      ),
    );

  const diagnosticRows =
    ranking.map(
      (row) => {
        const stock =
          stockMap.get(
            row.stockCode,
          );

        const featurePresence =
          (
            inputs.find(
              (input) =>
                input.stockCode ===
                row.stockCode,
            )
              ?.metadata as
              | {
                  sourcePresence?: Record<
                    string,
                    boolean
                  >;
                }
              | undefined
          )
            ?.sourcePresence ??
          {};

        return {
          rank:
            row.rank,

          stockCode:
            row.stockCode,

          stockName:
            stock
              ?.stock_name ??
            null,

          market:
            stock
              ?.market ??
            null,

          sector:
            stock
              ?.sector ??
            null,

          score:
            row.score,

          baseScore:
            row.baseScore,

          riskAdjustedScore:
            row.riskAdjustedScore,

          coverage:
            row.coverage,

          quality:
            row.quality,

          riskPenalty:
            row.riskPenalty,

          scorerEligibleForEntryTiming:
            row.eligibleForEntryTiming,

          /**
           * Hard runner-level gate:
           * this first DB runner is diagnostic only.
           */
          executionEligible:
            false,

          executionBlockers: [
            "READ_ONLY_DIAGNOSTIC_RUN",
            "FLOW_SOURCE_NOT_CONNECTED",
            "RISK_VALIDATION_NOT_BOUND_TO_PROPOSED_TRADE",
          ],

          featurePresence,

          blockingIssues:
            row.blockingIssues,

          warnings:
            row.warnings,

          reasons:
            row.reasons,
        };
      },
    );

  const report = {
    status:
      "ALPHA_V1_REAL_RUNNER_DB_READ_ONLY_COMPLETE",

    version:
      VERSION,

    decisionAt:
      config.decisionAt,

    track:
      config.track,

    database: {
      authMode:
        supabaseConfig.authMode,

      reads: {
        stocks:
          stockResult.stocks.length,

        marketSnapshots:
          snapshots.length,

        rawPredictions:
          predictionResult.rawRows.length,

        normalizedPredictions:
          predictionResult.normalized.length,
      },

      writes:
        0,
    },

    sourceStatus: {
      catalyst:
        "CONNECTED_AI_STOCK_PREDICTIONS",

      eventPersistence:
        "CONNECTED_AI_STOCK_PREDICTIONS_HISTORY",

      marketRegime:
        regime
          ? "CONNECTED_READ_ONLY_SNAPSHOT_PROXY"
          : "UNAVAILABLE",

      priceVolume:
        "CONNECTED_MARKET_SNAPSHOTS",

      liquidity:
        "CONNECTED_MARKET_SNAPSHOTS_TURNOVER_PROXY",

      flow:
        "UNAVAILABLE_NO_CONFIRMED_SOURCE",

      riskPenalty:
        "DEFERRED_UNTIL_PROPOSED_TRADE_PREFLIGHT_NO_CANDIDATE_STAGE_PENALTY",
    },

    regime,

    counts: {
      activeStocks:
        stockResult.stocks.length,

      analyzedStocks:
        diagnosticRows.length,

      scorerEligible:
        diagnosticRows.filter(
          (row) =>
            row
              .scorerEligibleForEntryTiming,
        ).length,

      executionEligible:
        0,
    },

    ranking:
      diagnosticRows,

    warnings,

    safety: {
      databaseReads:
        3,

      databaseWrites:
        0,

      networkRequests:
        3,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,

      diagnosticOnly:
        true,
    },

    nextGate:
      "ALPHA_V1_REVIEW_REAL_RANKING_THEN_ADD_FLOW_SOURCE_OR_PRE_ENTRY_RISK_BINDING",
  };

  const outputFile =
    path.resolve(
      process.cwd(),
      "logs",
      "alpha-v1-real-runner-db-read-only.json",
    );

  fs.mkdirSync(
    path.dirname(
      outputFile,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  printCompact({
    status:
      report.status,

    version:
      report.version,

    decisionAt:
      report.decisionAt,

    track:
      report.track,

    database:
      report.database,

    sourceStatus:
      report.sourceStatus,

    counts:
      report.counts,

    topRanking:
      report.ranking.slice(
        0,
        10,
      ),

    warnings:
      report.warnings,

    safety:
      report.safety,

    nextGate:
      report.nextGate,

    outputFile:
      "logs/alpha-v1-real-runner-db-read-only.json",
  });
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_REAL_RUNNER_DB_READ_ONLY_FAILED",

          version:
            VERSION,

          error:
            String(
              error?.message ??
              error,
            ),

          safety: {
            databaseWrites:
              0,

            ordersCreated:
              0,

            productionDecisionApplied:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
  },
);
