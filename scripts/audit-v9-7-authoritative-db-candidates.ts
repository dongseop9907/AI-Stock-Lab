import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createSupabaseServerClient } from "../lib/supabase";

const RUN_ID =
  "5c2b20cb-a468-4575-b9b6-cedb4841b043";

const EXPECTED_PAGE_COUNT = 4365;
const EXPECTED_CANDIDATE_COUNT = 20181;

const EXPECTED_TYPES: Record<string, number> = {
  CASH_DIVIDEND: 9474,
  MERGER: 1405,
  REVERSE_SPLIT: 504,
  RIGHTS_ISSUE: 8255,
  SPIN_OFF: 313,
  STOCK_DIVIDEND: 113,
  STOCK_SPLIT: 117,
};

const PAGE_SIZE = 500;

function sha256(value: string) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function candidateType(row: any) {
  return String(
    row?.candidateActionType ??
    row?.actionType ??
    row?.action_type ??
    ""
  ).trim();
}

function receiptNo(row: any) {
  return String(
    row?.receiptNo ??
    row?.rcept_no ??
    row?.receipt_no ??
    ""
  ).trim();
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const pages: any[] = [];

  for (
    let from = 0;
    ;
    from += PAGE_SIZE
  ) {
    const to =
      from + PAGE_SIZE - 1;

    const {
      data,
      error,
    } =
      await supabase
        .from(
          "corporate_action_source_inventory_pages",
        )
        .select(`
          run_id,
          chunk_start,
          chunk_end,
          corp_cls,
          page_no,
          total_count,
          total_pages,
          response_sha256,
          candidates,
          fetched_at
        `)
        .eq(
          "run_id",
          RUN_ID,
        )
        .order(
          "chunk_start",
          { ascending: true },
        )
        .order(
          "corp_cls",
          { ascending: true },
        )
        .order(
          "page_no",
          { ascending: true },
        )
        .range(from, to);

    if (error) {
      throw new Error(
        `PAGE_QUERY_FAILED:${from}:${error.message}`,
      );
    }

    const batch =
      data ?? [];

    pages.push(
      ...batch,
    );

    console.log(
      `READ pages=${pages.length}`,
    );

    if (
      batch.length <
      PAGE_SIZE
    ) {
      break;
    }
  }

  const corpus: any[] = [];

  const invalidCandidateArrays: any[] = [];
  const invalidHashes: any[] = [];
  const pageIdentitySet =
    new Set<string>();

  const duplicatePageIdentities: string[] = [];

  const pageGroups =
    new Map<
      string,
      {
        totalPages: number | null;
        pages: number[];
      }
    >();

  for (const page of pages) {
    const pageKey =
      [
        page.chunk_start,
        page.chunk_end,
        page.corp_cls,
        page.page_no,
      ].join("|");

    if (
      pageIdentitySet.has(pageKey)
    ) {
      duplicatePageIdentities.push(
        pageKey,
      );
    }

    pageIdentitySet.add(
      pageKey,
    );

    if (
      !/^[a-f0-9]{64}$/i.test(
        String(
          page.response_sha256 ??
          "",
        ),
      )
    ) {
      invalidHashes.push({
        pageKey,
        response_sha256:
          page.response_sha256,
      });
    }

    if (
      !Array.isArray(
        page.candidates,
      )
    ) {
      invalidCandidateArrays.push({
        pageKey,
      });

      continue;
    }

    const groupKey =
      [
        page.chunk_start,
        page.chunk_end,
        page.corp_cls,
      ].join("|");

    if (
      !pageGroups.has(groupKey)
    ) {
      pageGroups.set(
        groupKey,
        {
          totalPages:
            Number.isFinite(
              Number(
                page.total_pages,
              ),
            )
              ? Number(
                  page.total_pages,
                )
              : null,
          pages: [],
        },
      );
    }

    pageGroups
      .get(groupKey)!
      .pages.push(
        Number(
          page.page_no,
        ),
      );

    for (
      let index = 0;
      index <
      page.candidates.length;
      index++
    ) {
      corpus.push({
        ...page.candidates[index],

        __source: {
          runId:
            RUN_ID,

          chunkStart:
            page.chunk_start,

          chunkEnd:
            page.chunk_end,

          corpCls:
            page.corp_cls,

          pageNo:
            page.page_no,

          candidateIndex:
            index,

          responseSha256:
            page.response_sha256,
        },
      });
    }
  }

  const incompletePageGroups: any[] = [];

  for (
    const [
      groupKey,
      group,
    ]
    of pageGroups
  ) {
    const observed =
      [...group.pages]
        .sort(
          (a, b) => a - b,
        );

    const uniqueObserved =
      [...new Set(observed)];

    if (
      group.totalPages !== null &&
      group.totalPages > 0
    ) {
      const expected =
        Array.from(
          {
            length:
              group.totalPages,
          },
          (_, i) =>
            i + 1,
        );

      if (
        JSON.stringify(
          uniqueObserved,
        ) !==
        JSON.stringify(
          expected,
        )
      ) {
        incompletePageGroups.push({
          groupKey,
          expectedPages:
            group.totalPages,
          observedPages:
            uniqueObserved,
        });
      }
    }
  }

  const typeCounts:
    Record<string, number> =
    {};

  const identities =
    new Map<string, any>();

  const rowsWithoutIdentity: any[] =
    [];

  const duplicateCandidateIdentities:
    any[] = [];

  for (const candidate of corpus) {
    const type =
      candidateType(
        candidate,
      );

    const receipt =
      receiptNo(
        candidate,
      );

    typeCounts[type || "UNKNOWN"] =
      (
        typeCounts[
          type || "UNKNOWN"
        ] ?? 0
      ) + 1;

    if (
      !type ||
      !receipt
    ) {
      rowsWithoutIdentity.push({
        type:
          type || null,

        receiptNo:
          receipt || null,

        source:
          candidate.__source,
      });

      continue;
    }

    const key =
      `${receipt}|${type}`;

    if (
      identities.has(key)
    ) {
      duplicateCandidateIdentities
        .push({
          key,
          first:
            identities.get(key)
              ?.__source,
          duplicate:
            candidate.__source,
        });

      continue;
    }

    identities.set(
      key,
      candidate,
    );
  }

  const typeChecks =
    Object.fromEntries(
      Object.entries(
        EXPECTED_TYPES,
      ).map(
        ([
          type,
          expected,
        ]) => {
          const observed =
            typeCounts[type] ?? 0;

          return [
            type,
            {
              expected,
              observed,
              delta:
                observed -
                expected,
              passed:
                observed ===
                expected,
            },
          ];
        },
      ),
    );

  const unexpectedTypes =
    Object.keys(typeCounts)
      .filter(
        type =>
          !Object.prototype
            .hasOwnProperty.call(
              EXPECTED_TYPES,
              type,
            ),
      );

  const corpusCanonical =
    [...identities.entries()]
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      )
      .map(
        ([identity, row]) => ({
          identity,
          ...row,
        }),
      );

  const corpusFingerprint =
    sha256(
      JSON.stringify(
        corpusCanonical,
      ),
    );

  const passed =
    pages.length ===
      EXPECTED_PAGE_COUNT &&
    corpus.length ===
      EXPECTED_CANDIDATE_COUNT &&
    identities.size ===
      EXPECTED_CANDIDATE_COUNT &&
    duplicatePageIdentities.length ===
      0 &&
    duplicateCandidateIdentities.length ===
      0 &&
    rowsWithoutIdentity.length ===
      0 &&
    invalidCandidateArrays.length ===
      0 &&
    invalidHashes.length ===
      0 &&
    incompletePageGroups.length ===
      0 &&
    unexpectedTypes.length ===
      0 &&
    Object.values(
      typeChecks,
    ).every(
      (check: any) =>
        check.passed,
    );

  const root =
    process.cwd();

  const logs =
    path.join(
      root,
      "logs",
    );

  fs.mkdirSync(
    logs,
    {
      recursive: true,
    },
  );

  const corpusFile =
    path.join(
      logs,
      "v9-7-authoritative-candidate-corpus.json",
    );

  fs.writeFileSync(
    corpusFile,
    JSON.stringify(
      {
        version:
          "V9_7_AUTHORITATIVE_CANDIDATE_CORPUS_V1",

        runId:
          RUN_ID,

        candidateCount:
          corpusCanonical.length,

        fingerprint:
          corpusFingerprint,

        candidates:
          corpusCanonical,
      },
      null,
      2,
    ),
    "utf8",
  );

  const report = {
    version:
      "V9_7_AUTHORITATIVE_DB_CANDIDATE_AUDIT_V1",

    status:
      passed
        ? "PASS"
        : "REVIEW_REQUIRED",

    runId:
      RUN_ID,

    pages: {
      expected:
        EXPECTED_PAGE_COUNT,

      observed:
        pages.length,

      duplicatePageIdentities:
        duplicatePageIdentities.length,

      invalidHashes:
        invalidHashes.length,

      invalidCandidateArrays:
        invalidCandidateArrays.length,

      incompletePageGroups:
        incompletePageGroups.length,
    },

    candidates: {
      expected:
        EXPECTED_CANDIDATE_COUNT,

      raw:
        corpus.length,

      uniqueIdentities:
        identities.size,

      duplicateIdentities:
        duplicateCandidateIdentities.length,

      rowsWithoutIdentity:
        rowsWithoutIdentity.length,
    },

    typeCounts,

    typeChecks,

    unexpectedTypes,

    corpusFingerprint,

    outputFile:
      path
        .relative(
          root,
          corpusFile,
        )
        .replaceAll(
          "\\",
          "/",
        ),

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      openDartRequests:
        0,

      productionApplied:
        false,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      passed
        ? "BUILD_HISTORICAL_20181_CANDIDATE_DISPOSITION_FINALIZER"
        : "STOP_AND_RECONCILE_AUTHORITATIVE_DB_INVENTORY",
  };

  const auditFile =
    path.join(
      logs,
      "v9-7-authoritative-candidate-audit.json",
    );

  fs.writeFileSync(
    auditFile,
    JSON.stringify(
      {
        ...report,

        diagnostics: {
          duplicateCandidateIdentities:
            duplicateCandidateIdentities
              .slice(0, 20),

          rowsWithoutIdentity:
            rowsWithoutIdentity
              .slice(0, 20),

          incompletePageGroups:
            incompletePageGroups
              .slice(0, 20),

          invalidHashes:
            invalidHashes
              .slice(0, 20),
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    "\n" +
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

main().catch(
  error => {
    console.error(
      error instanceof Error
        ? error.stack
        : error,
    );

    process.exitCode = 1;
  },
);
