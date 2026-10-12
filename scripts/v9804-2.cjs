'use strict';

/**
 * AI Stock Lab
 * V9.8.4 - OpenDART correction / withdrawal chain resolver
 *
 * READ-ONLY with respect to production and Supabase.
 *
 * Input:
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *
 * Outputs:
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-2.json
 *   logs/v9-8-4-dart-list/<corpCode>.json
 *
 * Method:
 *   - For each company in the chain-resolution queue, read its OpenDART filing
 *     history from 2015-01-01 through the source through-date.
 *   - last_reprt_at=N so corrections are included.
 *   - Reconstruct decision/correction/withdrawal sequences conservatively.
 *   - Structured API receipt numbers, when available locally from V9.8.3,
 *     are used only as supporting evidence.
 *   - Fail closed when more than one plausible original exists.
 *
 * No DB writes.
 * No canonical event inserts.
 * No provider_event_id persistence.
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9804.cjs
 *
 * Resume:
 *   run the same command again; company histories are cached.
 *
 * Refresh:
 *   node --env-file=.env.local .\scripts\v9804.cjs --refresh
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_4_2_OPENDART_TARGET_CLASSIFICATION_CONSISTENCY_FIX';

const INPUT_VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const HISTORY_START = '20150101';
const PAGE_COUNT = 100;
const REQUEST_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 45000;
const PRIMARY_CHAIN_WINDOW_DAYS = 180;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function parseArgs(argv) {
  const out = {
    input: null,
    output: null,
    refresh: false,
  };

  for (const arg of argv) {
    if (arg === '--refresh') {
      out.refresh = true;
      continue;
    }

    if (arg.startsWith('--input=')) {
      out.input = arg.slice('--input='.length);
      continue;
    }

    if (arg.startsWith('--output=')) {
      out.output = arg.slice('--output='.length);
      continue;
    }

    throw new Error('UNKNOWN_OPTION');
  }

  return out;
}

function readEnvFile(root) {
  const file = path.join(root, '.env.local');
  const out = {};

  if (!fs.existsSync(file)) {
    return out;
  }

  const text =
    fs.readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '');

  for (const line of text.split(/\r?\n/)) {
    const m =
      line.match(
        /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/,
      );

    if (!m) {
      continue;
    }

    let value = m[2];

    if (
      value.startsWith('"') ||
      value.startsWith("'")
    ) {
      const quote = value[0];
      const end = value.indexOf(quote, 1);

      if (end < 0) {
        continue;
      }

      value = value.slice(1, end);
    } else {
      value = value
        .replace(/\s+#.*$/, '')
        .trim();
    }

    out[m[1]] = value;
  }

  return out;
}

function requireDartKey(root) {
  const fileEnv = readEnvFile(root);

  for (const name of [
    'OPENDART_API_KEY',
    'OPEN_DART_API_KEY',
    'DART_API_KEY',
    'DART_KEY',
    'OPEN_DART_KEY',
  ]) {
    const value =
      String(
        process.env[name] ??
        fileEnv[name] ??
        '',
      ).trim();

    if (value) {
      return value;
    }
  }

  throw new Error('DART_API_KEY_REQUIRED');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp = `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactTitle(value) {
  return normalizeTitle(value)
    .replace(/\s+/g, '');
}

function correctionPrefixInfo(title) {
  const t = compactTitle(title);

  /*
   * OpenDART can stack correction-related prefixes, for example:
   *
   *   [기재정정]...
   *   [첨부정정]...
   *   [정정]...
   *   [정정명령부과][기재정정]...
   *   [정정명령부과][첨부정정]...
   *
   * Only leading prefix tokens are inspected so an unrelated "정정"
   * appearing later in the title does not automatically classify the
   * disclosure as a correction.
   */
  const leadingBracketPrefixes = [];
  let rest = t;

  while (true) {
    const match = rest.match(/^\[([^\]]+)\]/);

    if (!match) {
      break;
    }

    leadingBracketPrefixes.push(
      match[1],
    );

    rest = rest.slice(
      match[0].length,
    );
  }

  const correction =
    leadingBracketPrefixes.some(
      (prefix) =>
        /(?:기재정정|첨부정정|정정명령부과|정정)/.test(
          prefix,
        ),
    ) ||
    /^(?:기재|첨부)?정정/.test(
      rest,
    );

  return {
    correction,
    prefixes:
      leadingBracketPrefixes,
    strippedTitle:
      rest.replace(
        /^(?:기재|첨부)?정정/,
        '',
      ),
  };
}

function stripCorrectionPrefix(title) {
  return correctionPrefixInfo(
    title,
  ).strippedTitle;
}

function isCorrection(title) {
  return correctionPrefixInfo(
    title,
  ).correction;
}

function isWithdrawal(title) {
  return /철회/.test(
    compactTitle(title),
  );
}

function isOtherEntity(title) {
  return /종속회사|자회사/.test(
    compactTitle(title),
  );
}

function dividendSubtype(title) {
  const t = compactTitle(title);

  if (/분기배당/.test(t)) {
    return 'QUARTERLY';
  }

  if (/중간배당/.test(t)) {
    return 'INTERIM';
  }

  if (/결산배당|기말배당/.test(t)) {
    return 'FINAL';
  }

  return 'UNSPECIFIED';
}

function classifyActionType(title) {
  const t = stripCorrectionPrefix(title);

  if (
    /주식배당결정/.test(t)
  ) {
    return 'STOCK_DIVIDEND';
  }

  if (
    /현금[ㆍ·및,]?(?:현물)?배당결정/.test(t) ||
    /현금배당결정/.test(t)
  ) {
    return 'CASH_DIVIDEND';
  }

  if (
    /주식병합결정/.test(t) ||
    (
      /주식병합/.test(t) &&
      /철회/.test(t)
    )
  ) {
    return 'REVERSE_SPLIT';
  }

  if (
    /주식분할결정/.test(t) ||
    (
      /주식분할/.test(t) &&
      /철회/.test(t)
    )
  ) {
    return 'STOCK_SPLIT';
  }

  if (
    /회사분할합병결정/.test(t) ||
    /분할합병결정/.test(t) ||
    (
      /회사분할합병/.test(t) &&
      /철회/.test(t)
    )
  ) {
    return 'SPIN_OFF';
  }

  if (
    /회사분할결정/.test(t) ||
    (
      /회사분할/.test(t) &&
      /철회/.test(t)
    )
  ) {
    return 'SPIN_OFF';
  }

  if (
    /회사합병결정/.test(t) ||
    (
      /회사합병/.test(t) &&
      /철회/.test(t)
    )
  ) {
    return 'MERGER';
  }

  return null;
}

function strictDecision(title, actionType) {
  if (isWithdrawal(title)) {
    return false;
  }

  return (
    classifyActionType(title) ===
    actionType
  );
}

function chainKeyFor({
  actionType,
  title,
  otherEntity,
}) {
  const parts = [
    actionType,
    otherEntity
      ? 'OTHER_ENTITY'
      : 'REPORTING_ENTITY',
  ];

  if (
    actionType ===
    'CASH_DIVIDEND' ||
    actionType ===
    'STOCK_DIVIDEND'
  ) {
    parts.push(
      dividendSubtype(title),
    );
  }

  return parts.join('|');
}

function sqlDateFromCompact(value) {
  const text = String(value ?? '');

  if (!/^\d{8}$/.test(text)) {
    return null;
  }

  return (
    `${text.slice(0, 4)}-` +
    `${text.slice(4, 6)}-` +
    text.slice(6, 8)
  );
}

function daysBetween(a, b) {
  const aDate =
    new Date(
      `${sqlDateFromCompact(a)}T00:00:00Z`,
    );

  const bDate =
    new Date(
      `${sqlDateFromCompact(b)}T00:00:00Z`,
    );

  return Math.floor(
    (
      bDate.getTime() -
      aDate.getTime()
    ) /
      86400000,
  );
}

function normalizeListRow(row) {
  return {
    corpCode:
      String(
        row.corp_code ??
        '',
      ).trim(),

    corpName:
      String(
        row.corp_name ??
        '',
      ).trim(),

    stockCode:
      String(
        row.stock_code ??
        '',
      ).trim() ||
      null,

    corpCls:
      String(
        row.corp_cls ??
        '',
      ).trim(),

    reportName:
      normalizeTitle(
        row.report_nm,
      ),

    receiptNo:
      String(
        row.rcept_no ??
        '',
      ).trim(),

    receiptDate:
      String(
        row.rcept_dt ??
        '',
      ).trim(),

    filerName:
      String(
        row.flr_nm ??
        '',
      ).trim(),

    remark:
      String(
        row.rm ??
        '',
      ).trim(),
  };
}

async function fetchCorpHistory({
  key,
  corpCode,
  endDate,
}) {
  const rows = [];
  const pages = [];

  let pageNo = 1;
  let totalPage = null;

  while (
    totalPage === null ||
    pageNo <= totalPage
  ) {
    const url =
      new URL(
        'https://opendart.fss.or.kr/api/list.json',
      );

    url.search =
      new URLSearchParams({
        crtfc_key:
          key,

        corp_code:
          corpCode,

        bgn_de:
          HISTORY_START,

        end_de:
          endDate,

        last_reprt_at:
          'N',

        sort:
          'date',

        sort_mth:
          'asc',

        page_no:
          String(pageNo),

        page_count:
          String(PAGE_COUNT),
      }).toString();

    const response =
      await fetch(
        url,
        {
          method:
            'GET',

          cache:
            'no-store',

          redirect:
            'error',

          signal:
            AbortSignal.timeout(
              REQUEST_TIMEOUT_MS,
            ),
        },
      );

    const text =
      (
        await response.text()
      ).replace(/^\uFEFF/, '');

    let body;

    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        'DART_LIST_INVALID_JSON',
      );
    }

    const status =
      String(
        body?.status ??
        '',
      );

    if (
      status ===
      '013'
    ) {
      return {
        corpCode,
        startDate:
          HISTORY_START,

        endDate,

        rows:
          [],

        pages: [{
          pageNo:
            1,

          totalPage:
            0,

          totalCount:
            0,

          responseSha256:
            sha256(text),
        }],
      };
    }

    if (
      !response.ok ||
      status !==
        '000'
    ) {
      throw new Error(
        `DART_LIST_STATUS_${status || response.status}`,
      );
    }

    if (
      !Array.isArray(
        body.list,
      )
    ) {
      throw new Error(
        'DART_LIST_ROWS_MISSING',
      );
    }

    totalPage =
      Number(
        body.total_page ??
        0,
      );

    const totalCount =
      Number(
        body.total_count ??
        0,
      );

    if (
      !Number.isInteger(
        totalPage,
      ) ||
      totalPage <
        0 ||
      !Number.isInteger(
        totalCount,
      ) ||
      totalCount <
        0
    ) {
      throw new Error(
        'DART_LIST_PAGINATION_INVALID',
      );
    }

    const normalized =
      body.list.map(
        normalizeListRow,
      );

    rows.push(
      ...normalized,
    );

    pages.push({
      pageNo,

      totalPage,

      totalCount,

      rowCount:
        normalized.length,

      responseSha256:
        sha256(text),
    });

    pageNo += 1;

    if (
      pageNo <=
      totalPage
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const seen =
    new Set();

  const deduped = [];

  for (const row of rows) {
    const id =
      row.receiptNo;

    if (
      !/^\d{14}$/.test(id)
    ) {
      throw new Error(
        'DART_LIST_RECEIPT_ID_INVALID',
      );
    }

    if (!seen.has(id)) {
      seen.add(id);
      deduped.push(row);
    }
  }

  deduped.sort(
    (a, b) =>
      String(a.receiptDate)
        .localeCompare(
          String(b.receiptDate),
        ) ||
      String(a.receiptNo)
        .localeCompare(
          String(b.receiptNo),
        ),
  );

  return {
    corpCode,
    startDate:
      HISTORY_START,

    endDate,

    rows:
      deduped,

    pages,
  };
}

function structuredReceiptNos(
  root,
  row,
) {
  const file =
    row?.structured?.file;

  if (!file) {
    return [];
  }

  const absolute =
    path.join(
      root,
      file,
    );

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const body =
    JSON.parse(
      fs
        .readFileSync(
          absolute,
          'utf8',
        )
        .replace(/^\uFEFF/, ''),
    );

  const list =
    Array.isArray(
      body?.list,
    )
      ? body.list
      : [];

  return [
    ...new Set(
      list
        .map(
          (entry) =>
            String(
              entry?.rcept_no ??
              '',
            ),
        )
        .filter(
          (receiptNo) =>
            /^\d{14}$/.test(
              receiptNo,
            ),
        ),
    ),
  ];
}

function buildRelevantHistory(
  history,
  target,
) {
  const targetKey =
    chainKeyFor({
      actionType:
        target.actionType,

      title:
        target.reportName,

      otherEntity:
        Boolean(
          target.otherEntity,
        ),
    });

  return history.rows
    .map(
      (row) => {
        const actionType =
          classifyActionType(
            row.reportName,
          );

        if (!actionType) {
          return null;
        }

        const otherEntity =
          isOtherEntity(
            row.reportName,
          );

        const key =
          chainKeyFor({
            actionType,

            title:
              row.reportName,

            otherEntity,
          });

        if (
          key !==
          targetKey
        ) {
          return null;
        }

        return {
          ...row,

          actionType,

          correction:
            isCorrection(
              row.reportName,
            ),

          withdrawal:
            isWithdrawal(
              row.reportName,
            ),

          otherEntity,

          chainKey:
            key,

          strictDecision:
            strictDecision(
              row.reportName,
              actionType,
            ),
        };
      },
    )
    .filter(Boolean);
}

function resolveOne({
  root,
  target,
  history,
}) {
  const relevant =
    buildRelevantHistory(
      history,
      target,
    );

  const targetHistoryRow =
    relevant.find(
      (row) =>
        row.receiptNo ===
        target.receiptNo,
    ) ??
    null;

  if (!targetHistoryRow) {
    return {
      status:
        'UNRESOLVED',

      reason:
        'TARGET_RECEIPT_NOT_FOUND_IN_CORP_DISCLOSURE_HISTORY',

      rootReceiptNo:
        null,

      confidence:
        'NONE',

      targetHistoryRow:
        null,

      plausibleRoots:
        [],

      relevantHistory:
        relevant,
    };
  }

  if (
    !targetHistoryRow.correction &&
    !targetHistoryRow.withdrawal
  ) {
    return {
      status:
        'RESOLVED',

      reason:
        'TARGET_IS_ORIGINAL_DECISION_DISCLOSURE',

      rootReceiptNo:
        target.receiptNo,

      confidence:
        'HIGH',

      targetHistoryRow,

      plausibleRoots: [
        target.receiptNo,
      ],

      relevantHistory:
        relevant,
    };
  }

  const priorOriginals =
    relevant.filter(
      (row) =>
        row.strictDecision &&
        !row.correction &&
        !row.withdrawal &&
        (
          row.receiptDate <
            target.receiptDate ||
          (
            row.receiptDate ===
              target.receiptDate &&
            row.receiptNo <
              target.receiptNo
          )
        ),
    );

  if (
    priorOriginals.length ===
    0
  ) {
    return {
      status:
        'UNRESOLVED',

      reason:
        'NO_PRIOR_ORIGINAL_DECISION_DISCLOSURE',

      rootReceiptNo:
        null,

      confidence:
        'NONE',

      targetHistoryRow,

      plausibleRoots:
        [],

      relevantHistory:
        relevant,
    };
  }

  const withinPrimaryWindow =
    priorOriginals.filter(
      (row) => {
        const distance =
          daysBetween(
            row.receiptDate,
            target.receiptDate,
          );

        return (
          distance >= 0 &&
          distance <=
            PRIMARY_CHAIN_WINDOW_DAYS
        );
      },
    );

  const basePool =
    withinPrimaryWindow.length >
      0
      ? withinPrimaryWindow
      : priorOriginals.slice(-1);

  const structuredNos =
    new Set(
      structuredReceiptNos(
        root,
        target,
      ),
    );

  const structuredMatches =
    basePool.filter(
      (row) =>
        structuredNos.has(
          row.receiptNo,
        ),
    );

  if (
    structuredMatches.length ===
    1
  ) {
    return {
      status:
        'RESOLVED',

      reason:
        'UNIQUE_PRIOR_ORIGINAL_MATCHED_STRUCTURED_RECEIPT_HISTORY',

      rootReceiptNo:
        structuredMatches[0]
          .receiptNo,

      confidence:
        'HIGH',

      targetHistoryRow,

      plausibleRoots:
        basePool.map(
          (row) =>
            row.receiptNo,
        ),

      structuredCandidateReceiptNos:
        [...structuredNos],

      relevantHistory:
        relevant,
    };
  }

  if (
    basePool.length ===
    1
  ) {
    const candidate =
      basePool[0];

    const distanceDays =
      daysBetween(
        candidate.receiptDate,
        target.receiptDate,
      );

    return {
      status:
        'RESOLVED',

      reason:
        withinPrimaryWindow.length ===
          1
          ? 'UNIQUE_PRIOR_ORIGINAL_WITHIN_PRIMARY_CHAIN_WINDOW'
          : 'ONLY_PRIOR_ORIGINAL_AVAILABLE',

      rootReceiptNo:
        candidate.receiptNo,

      confidence:
        withinPrimaryWindow.length ===
          1
          ? 'MEDIUM'
          : 'LOW',

      targetHistoryRow,

      distanceDays,

      plausibleRoots: [
        candidate.receiptNo,
      ],

      structuredCandidateReceiptNos:
        [...structuredNos],

      relevantHistory:
        relevant,
    };
  }

  /*
   * Multiple roots inside the primary time window are deliberately not
   * guessed. Concurrent mergers/dividends can exist, so sequence alone is
   * insufficient to assign production identity.
   */
  return {
    status:
      'AMBIGUOUS',

    reason:
      structuredMatches.length >
        1
        ? 'MULTIPLE_PRIOR_ORIGINALS_MATCH_STRUCTURED_HISTORY'
        : 'MULTIPLE_PRIOR_ORIGINALS_IN_PRIMARY_CHAIN_WINDOW',

    rootReceiptNo:
      null,

    confidence:
      'NONE',

    targetHistoryRow,

    plausibleRoots:
      basePool.map(
        (row) =>
          row.receiptNo,
      ),

    structuredCandidateReceiptNos:
      [...structuredNos],

    relevantHistory:
      relevant,
  };
}

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key =
      String(
        selector(row) ??
        'NULL',
      );

    out[key] =
      (out[key] ?? 0) +
      1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
  );
}

async function main() {
  if (
    typeof fetch !==
    'function'
  ) {
    throw new Error(
      'NODE_18_OR_NEWER_REQUIRED',
    );
  }

  const args =
    parseArgs(
      process.argv.slice(2),
    );

  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.resolve(
      args.input ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
      ),
    );

  const cacheDir =
    path.join(
      root,
      'logs',
      'v9-8-4-dart-list',
    );

  if (!fs.existsSync(inputFile)) {
    throw new Error(
      'V9_8_3_1_INPUT_NOT_FOUND',
    );
  }

  const source =
    JSON.parse(
      fs
        .readFileSync(
          inputFile,
          'utf8',
        )
        .replace(/^\uFEFF/, ''),
    );

  if (
    source.version !==
      INPUT_VERSION ||
    source.status !==
      'PROVIDER_014_DISPOSITION_COMPLETE'
  ) {
    throw new Error(
      'V9_8_3_1_INPUT_NOT_READY',
    );
  }

  if (
    !Array.isArray(
      source.chainResolutionQueue,
    )
  ) {
    throw new Error(
      'CHAIN_RESOLUTION_QUEUE_MISSING',
    );
  }

  const resultByWorkId =
    new Map(
      source.results.map(
        (row) => [
          row.workId,
          row,
        ],
      ),
    );

  const targets =
    source.chainResolutionQueue.map(
      (entry) => {
        const full =
          resultByWorkId.get(
            entry.workId,
          );

        if (!full) {
          throw new Error(
            'CHAIN_QUEUE_WORK_ITEM_NOT_FOUND',
          );
        }

        return full;
      },
    );

  const sourceThroughDate =
    String(
      source?.source?.throughDate ??
      source?.source?.sourceThroughDate ??
      '',
    );

  let throughDate =
    sourceThroughDate.replaceAll(
      '-',
      '',
    );

  if (
    !/^\d{8}$/.test(
      throughDate,
    )
  ) {
    /*
     * V9.8.3.1 retained the V9.8.3 source object indirectly.
     * Fall back to the maximum target receipt date, which is still a
     * deterministic upper bound for chain reconstruction.
     */
    throughDate =
      targets
        .map(
          (row) =>
            String(
              row.receiptDate ??
              '',
            ),
        )
        .filter(
          (value) =>
            /^\d{8}$/.test(
              value,
            ),
        )
        .sort()
        .at(-1) ??
      '';
  }

  if (
    !/^\d{8}$/.test(
      throughDate,
    )
  ) {
    throw new Error(
      'CHAIN_RESOLUTION_THROUGH_DATE_UNAVAILABLE',
    );
  }

  const dartKey =
    requireDartKey(
      root,
    );

  const corpCodes =
    [
      ...new Set(
        targets.map(
          (row) =>
            row.corpCode,
        ),
      ),
    ].sort();

  const histories =
    new Map();

  let networkRequests =
    0;

  let reusedCorpHistories =
    0;

  for (
    let i = 0;
    i < corpCodes.length;
    i += 1
  ) {
    const corpCode =
      corpCodes[i];

    const cacheFile =
      path.join(
        cacheDir,
        `${corpCode}.json`,
      );

    let history = null;

    if (
      !args.refresh &&
      fs.existsSync(
        cacheFile,
      )
    ) {
      const cached =
        JSON.parse(
          fs
            .readFileSync(
              cacheFile,
              'utf8',
            )
            .replace(/^\uFEFF/, ''),
        );

      if (
        cached.corpCode ===
          corpCode &&
        cached.startDate ===
          HISTORY_START &&
        cached.endDate ===
          throughDate
      ) {
        history = cached;
        reusedCorpHistories += 1;
      }
    }

    if (!history) {
      history =
        await fetchCorpHistory({
          key:
            dartKey,

          corpCode,

          endDate:
            throughDate,
        });

      networkRequests +=
        history.pages.length;

      atomicSaveJson(
        cacheFile,
        history,
      );

      await sleep(
        REQUEST_DELAY_MS,
      );
    }

    histories.set(
      corpCode,
      history,
    );

    console.log(
      [
        history === null
          ? 'FETCHED'
          : 'HISTORY_READY',
        `${i + 1}/${corpCodes.length}`,
        `corp=${corpCode}`,
        `rows=${history.rows.length}`,
        `pages=${history.pages.length}`,
        `networkRequests=${networkRequests}`,
      ].join(' '),
    );
  }

  const resolutions =
    targets.map(
      (target) => {
        const history =
          histories.get(
            target.corpCode,
          );

        const resolution =
          resolveOne({
            root,
            target,
            history,
          });

        return {
          workId:
            target.workId,

          receiptNo:
            target.receiptNo,

          receiptDate:
            target.receiptDate,

          corpCode:
            target.corpCode,

          stockCode:
            target.stockCode,

          actionType:
            target.actionType,

          gate:
            target.gate,

          /*
           * Preserve the queue classification for auditability, but expose
           * the resolver's filing-history classification as the canonical
           * top-level value. This prevents summary counts and downstream
           * consumers from seeing stale V9.8.3-1 metadata when V9.8.4.x
           * reclassifies a filing title.
           */
          sourceCorrection:
            Boolean(
              target.correction,
            ),

          correction:
            resolution
              .targetHistoryRow
              ?.correction ??
            Boolean(
              target.correction,
            ),

          withdrawal:
            resolution
              .targetHistoryRow
              ?.withdrawal ??
            Boolean(
              target.withdrawal,
            ),

          otherEntity:
            resolution
              .targetHistoryRow
              ?.otherEntity ??
            Boolean(
              target.otherEntity,
            ),

          documentStatus:
            target?.document?.status ??
            null,

          providerStatus:
            target?.document?.providerStatus ??
            null,

          structuredStatus:
            target?.structured?.status ??
            null,

          resolutionStatus:
            resolution.status,

          resolutionReason:
            resolution.reason,

          rootReceiptNo:
            resolution.rootReceiptNo,

          confidence:
            resolution.confidence,

          distanceDays:
            resolution.distanceDays ??
            null,

          plausibleRoots:
            resolution.plausibleRoots,

          structuredCandidateReceiptNos:
            resolution
              .structuredCandidateReceiptNos ??
            [],

          targetHistoryRow:
            resolution.targetHistoryRow,

          relevantHistory:
            resolution.relevantHistory,
        };
      },
    );

  const resolved =
    resolutions.filter(
      (row) =>
        row.resolutionStatus ===
        'RESOLVED',
    );

  const ambiguous =
    resolutions.filter(
      (row) =>
        row.resolutionStatus ===
        'AMBIGUOUS',
    );

  const unresolved =
    resolutions.filter(
      (row) =>
        row.resolutionStatus ===
        'UNRESOLVED',
    );

  const correctionRows =
    resolutions.filter(
      (row) =>
        row.correction,
    );

  const withdrawalRows =
    resolutions.filter(
      (row) =>
        row.withdrawal,
    );

  const report = {
    version:
      VERSION,

    status:
      ambiguous.length ===
        0 &&
      unresolved.length ===
        0
        ? 'CHAIN_RESOLUTION_COMPLETE'
        : 'CHAIN_RESOLUTION_REVIEW_REQUIRED',

    source: {
      inputVersion:
        source.version,

      inputFile:
        path.relative(
          root,
          inputFile,
        ).replaceAll('\\', '/'),

      inputFingerprint:
        sha256(
          JSON.stringify(
            source.chainResolutionQueue,
          ),
        ),

      throughDate,

      historyStart:
        HISTORY_START,
    },

    counts: {
      chainTargets:
        resolutions.length,

      uniqueCorpCodes:
        corpCodes.length,

      resolved:
        resolved.length,

      ambiguous:
        ambiguous.length,

      unresolved:
        unresolved.length,

      highConfidence:
        resolved.filter(
          (row) =>
            row.confidence ===
            'HIGH',
        ).length,

      mediumConfidence:
        resolved.filter(
          (row) =>
            row.confidence ===
            'MEDIUM',
        ).length,

      lowConfidence:
        resolved.filter(
          (row) =>
            row.confidence ===
            'LOW',
        ).length,

      correctionTargets:
        correctionRows.length,

      correctionResolved:
        correctionRows.filter(
          (row) =>
            row.resolutionStatus ===
            'RESOLVED',
        ).length,

      withdrawalTargets:
        withdrawalRows.length,

      withdrawalResolved:
        withdrawalRows.filter(
          (row) =>
            row.resolutionStatus ===
            'RESOLVED',
        ).length,

      selfRootOriginals:
        resolved.filter(
          (row) =>
            row.rootReceiptNo ===
            row.receiptNo,
        ).length,
    },

    resolutionStatusCounts:
      countBy(
        resolutions,
        (row) =>
          row.resolutionStatus,
      ),

    resolutionReasonCounts:
      countBy(
        resolutions,
        (row) =>
          row.resolutionReason,
      ),

    confidenceCounts:
      countBy(
        resolutions,
        (row) =>
          row.confidence,
      ),

    actionTypeCounts:
      countBy(
        resolutions,
        (row) =>
          row.actionType,
      ),

    safety: {
      networkRequests,

      reusedCorpHistories,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      providerEventIdsPersisted:
        0,

      coverageWindowAdvanced:
        false,
    },

    policy: {
      historySource:
        'OPENDART_DISCLOSURE_LIST',

      historyStart:
        HISTORY_START,

      lastReportOnly:
        false,

      correctionsIncluded:
        true,

      primaryChainWindowDays:
        PRIMARY_CHAIN_WINDOW_DAYS,

      multiRootPolicy:
        'FAIL_CLOSED_AS_AMBIGUOUS_UNLESS_UNIQUE_STRUCTURED_ROOT_MATCH',

      provider014:
        'NO_DOCUMENT_XML_RETRY',

      canonicalization:
        'NOT_PERFORMED_IN_V9_8_4',
    },

    reviewQueue: [
      ...ambiguous,
      ...unresolved,
    ].map(
      (row) => ({
        workId:
          row.workId,

        receiptNo:
          row.receiptNo,

        receiptDate:
          row.receiptDate,

        corpCode:
          row.corpCode,

        stockCode:
          row.stockCode,

        actionType:
          row.actionType,

        gate:
          row.gate,

        correction:
          row.correction,

        withdrawal:
          row.withdrawal,

        resolutionStatus:
          row.resolutionStatus,

        resolutionReason:
          row.resolutionReason,

        plausibleRoots:
          row.plausibleRoots,

        structuredCandidateReceiptNos:
          row.structuredCandidateReceiptNos,
      }),
    ),

    resolutions,

    outputFile:
      path.relative(
        root,
        outputFile,
      ).replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          report.source.inputFingerprint,

        counts:
          report.counts,

        roots:
          resolutions.map(
            (row) => [
              row.workId,
              row.rootReceiptNo,
              row.resolutionStatus,
            ],
          ),
      }),
    );

  atomicSaveJson(
    outputFile,
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          VERSION,

        ...report.counts,

        resolutionReasonCounts:
          report.resolutionReasonCounts,

        confidenceCounts:
          report.confidenceCounts,

        networkRequests,

        reusedCorpHistories,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        providerEventIdsPersisted:
          0,

        coverageWindowAdvanced:
          false,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      String(
        error?.message ??
        error,
      )
        .replace(
          /[?&]crtfc_key=[^&\s]+/gi,
          '?crtfc_key=REDACTED',
        ),
    );

    process.exitCode = 1;
  },
);
