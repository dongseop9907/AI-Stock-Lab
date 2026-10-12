import fs from "node:fs";
import path from "node:path";

import {
  getDomesticStockOrderbook,
  getKisAccessToken,
} from "../lib/kis/client";

const ROOT = process.cwd();

const stockCode =
  process.argv[2]?.trim() ||
  "005930";

const SEARCH_ROOTS = [
  "lib",
  "app",
  "scripts",
] as const;

const SOURCE_PATTERNS = [
  /isKrxTrading/i,
  /isTradingDay/i,
  /isTradingDate/i,
  /tradingDate/i,
  /KRX/i,
  /market.*open/i,
  /session.*open/i,
  /holiday/i,
  /Korean.*Date/i,
  /Asia\/Seoul/i,
] as const;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out: string[] = [];

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true,
  })) {
    const abs =
      path.join(
        dir,
        entry.name,
      );

    if (entry.isDirectory()) {
      if (
        [
          "node_modules",
          ".next",
          ".git",
          "dist",
          "build",
          "backups",
        ].includes(entry.name)
      ) {
        continue;
      }

      out.push(
        ...walk(abs),
      );

      continue;
    }

    if (
      entry.isFile() &&
      /\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)
    ) {
      out.push(abs);
    }
  }

  return out;
}

function rel(abs: string) {
  return path
    .relative(
      ROOT,
      abs,
    )
    .replaceAll(
      "\\",
      "/",
    );
}

function sourceHits(abs: string) {
  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  const lines =
    text.split(/\r?\n/);

  const hits: Array<{
    line: number;
    text: string;
    matched: string[];
  }> = [];

  lines.forEach(
    (
      line,
      index,
    ) => {
      const matched =
        SOURCE_PATTERNS
          .filter(pattern =>
            pattern.test(line),
          )
          .map(pattern =>
            pattern.source,
          );

      if (matched.length > 0) {
        hits.push({
          line:
            index + 1,
          text:
            line.trim(),
          matched,
        });
      }
    },
  );

  return {
    file:
      rel(abs),
    hitCount:
      hits.length,
    hits:
      hits.slice(
        0,
        80,
      ),
  };
}

function pickTimeLikeFields(
  output: Record<string, unknown> | null | undefined,
) {
  if (!output) {
    return {};
  }

  const entries =
    Object.entries(output);

  return Object.fromEntries(
    entries.filter(
      ([key]) =>
        /(time|hour|acpt|bsop|date|deal|cls|stck.*date|aspr)/i.test(
          key,
        ),
    ),
  );
}

async function main() {
  const repoFiles =
    SEARCH_ROOTS.flatMap(
      root =>
        walk(
          path.join(
            ROOT,
            root,
          ),
        ),
    );

  const tradingSessionCandidates =
    repoFiles
      .map(sourceHits)
      .filter(row =>
        row.hitCount > 0,
      )
      .sort(
        (
          left,
          right,
        ) =>
          right.hitCount -
          left.hitCount,
      )
      .slice(
        0,
        40,
      );

  const token =
    await getKisAccessToken();

  const response =
    await getDomesticStockOrderbook(
      stockCode,
      token,
    );

  const output1 =
    (
      response.output1 ??
      {}
    ) as
      Record<string, unknown>;

  const output1Keys =
    Object.keys(
      output1,
    ).sort();

  const timeLikeFields =
    pickTimeLikeFields(
      output1,
    );

  const checks = {
    sourceScanCompleted:
      repoFiles.length >
      0,

    kisCallReturned:
      true,

    apiOk:
      response.rt_cd ===
        undefined ||
      response.rt_cd ===
        "0",

    tokenNotPrinted:
      true,
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, ok]) =>
          ok !== true,
      )
      .map(
        ([name]) =>
          name,
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length ===
            0
            ? "AI_STOCK_LAB_PAPER_ORDERBOOK_FRESHNESS_SOURCE_PROBE_PASS"
            : "AI_STOCK_LAB_PAPER_ORDERBOOK_FRESHNESS_SOURCE_PROBE_FAIL",

        target: {
          stockCode,
        },

        repository: {
          tradingSessionCandidateCount:
            tradingSessionCandidates.length,

          tradingSessionCandidates,
        },

        kisOrderbook: {
          rtCd:
            response.rt_cd ??
            null,

          msgCd:
            response.msg_cd ??
            null,

          output1KeyCount:
            output1Keys.length,

          output1Keys,

          timeLikeFields,
        },

        interpretation: {
          preferred:
            "Reuse an existing KRX trading-date/session helper if one exists.",

          ifServerTimeFieldExists:
            "Use server-provided quote time as additional provenance, but still require a KRX open-session gate.",

          ifNoServerTimeField:
            "Use receipt time only as transport receipt time, never as proof that the market quote itself is current.",

          websocket:
            "Not required for this PAPER snapshot step if REST is restricted to a valid KRX session and fetched immediately before execution.",
        },

        safety: {
          readOnlySourceScan:
            true,

          readOnlyKisCall:
            true,

          kisAccessTokenPrinted:
            false,

          databaseReads:
            0,

          databaseWrites:
            0,

          paperOrdersCreated:
            0,

          paperOrdersExecuted:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,
        },

        checks,
        failed,

        nextGate:
          failed.length ===
            0
            ? "BIND_ORDERBOOK_QUOTE_FRESHNESS_TO_KRX_SESSION_AND_SERVER_PROVENANCE"
            : "REVIEW_FRESHNESS_SOURCE_PROBE",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
      0
      ? 0
      : 1;
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDERBOOK_FRESHNESS_SOURCE_PROBE_FAIL",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          safety: {
            readOnlyKisCall:
              true,
            databaseWrites:
              0,
            paperOrdersCreated:
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
  },
);
