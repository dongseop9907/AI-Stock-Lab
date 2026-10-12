'use strict';

/**
 * AI Stock Lab
 * V9.8.1 - OpenDART incremental corporate-action inventory
 *
 * Purpose
 * -------
 * Read-only bridge from the completed V9.7 historical inventory to a future
 * continuous production pipeline.
 *
 * What it does:
 *   1) Reads the latest OPENDART_DISCLOSURE_LIST coverage end_date from Supabase.
 *   2) Uses the next calendar day as the default incremental start date.
 *   3) Downloads KOSPI(Y) + KOSDAQ(K) disclosure-list pages through --through.
 *   4) Conservatively classifies corporate-action candidates.
 *   5) Stores normalized disclosures, candidate rows, page hashes and progress.
 *
 * What it NEVER does:
 *   - no Supabase writes
 *   - no corporate_action_events inserts/upserts
 *   - no validation -> production promotion
 *   - no price/factor mutation
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9801.cjs
 *
 * Optional:
 *   node --env-file=.env.local .\scripts\v9801.cjs --through=2026-10-01
 *   node --env-file=.env.local .\scripts\v9801.cjs --start=2026-08-01 --through=2026-10-01
 *   node --env-file=.env.local .\scripts\v9801.cjs --refresh
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_11_1_INCREMENTAL_OPENDART_CORPORATE_ACTION_INVENTORY';
const PROVIDER = 'OPENDART_DISCLOSURE_LIST';
const PROVIDER_VERSION = 'V9_11_1_INCREMENTAL';
const CLASSIFIER_VERSION = 'V9_11_1_CONSERVATIVE_TITLE_CLASSIFIER';

const MARKET_CLASSES = Object.freeze([
  { corpCls: 'Y', market: 'KOSPI' },
  { corpCls: 'K', market: 'KOSDAQ' },
]);

const PAGE_COUNT = 100;
const REQUEST_DELAY_MS = 250;
const API_TIMEOUT_MS = 45000;

const ACTION_TYPES = Object.freeze([
  'CASH_DIVIDEND',
  'STOCK_DIVIDEND',
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'MERGER',
  'SPIN_OFF',
  'RIGHTS_ISSUE',
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error) {
  const raw =
    error instanceof Error
      ? error.message
      : String(error ?? 'UNKNOWN_ERROR');

  if (/^[A-Z0-9_:.\-]+$/.test(raw)) {
    return raw;
  }

  return 'REQUEST_FAILED';
}

function parseArgs(argv) {
  const out = {
    start: null,
    through: null,
    refresh: false,
    output: null,
  };

  for (const arg of argv) {
    if (arg === '--refresh') {
      out.refresh = true;
      continue;
    }

    if (arg.startsWith('--start=')) {
      out.start = arg.slice('--start='.length);
      continue;
    }

    if (arg.startsWith('--through=')) {
      out.through = arg.slice('--through='.length);
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

function parseSqlDate(value, label) {
  const text = String(value ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`INVALID_${label}_DATE`);
  }

  const d = new Date(`${text}T00:00:00Z`);

  if (
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== text
  ) {
    throw new Error(`INVALID_${label}_DATE`);
  }

  return text;
}

function compactDate(sqlDate) {
  return sqlDate.replaceAll('-', '');
}

function addCalendarDays(sqlDate, days) {
  const d = new Date(`${sqlDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function koreanToday() {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      },
    ).formatToParts(new Date());

  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${map.year}-${map.month}-${map.day}`;
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

function correctionHint(title) {
  return (
    /\[(?:기재|첨부)?정정\]/.test(title) ||
    /(?:기재|첨부)?정정/.test(title)
  );
}

function withdrawalHint(title) {
  return /철회/.test(title);
}

function otherEntityScopeHint(title) {
  return /종속회사|자회사/.test(title);
}

function classifyCandidate(reportName) {
  const title = compactTitle(reportName);

  let actionType = null;
  let classifierReason = null;

  /*
   * Order matters:
   * - stock dividend before generic dividend
   * - split-merger before split
   * - reverse split before split
   */
  if (
    /주식배당결정/.test(title)
  ) {
    actionType = 'STOCK_DIVIDEND';
    classifierReason = 'TITLE_STOCK_DIVIDEND_DECISION';
  } else if (
    /현금[ㆍ·및,]?(?:현물)?배당결정/.test(title) ||
    /현금배당결정/.test(title)
  ) {
    actionType = 'CASH_DIVIDEND';
    classifierReason = 'TITLE_CASH_OR_IN_KIND_DIVIDEND_DECISION';
  } else if (
    /주식병합/.test(title)
  ) {
    actionType = 'REVERSE_SPLIT';
    classifierReason = 'TITLE_REVERSE_SPLIT';
  } else if (
    /주식분할/.test(title)
  ) {
    actionType = 'STOCK_SPLIT';
    classifierReason = 'TITLE_STOCK_SPLIT';
  } else if (
    /회사분할합병결정/.test(title) ||
    /분할합병결정/.test(title)
  ) {
    actionType = 'SPIN_OFF';
    classifierReason = 'TITLE_SPLIT_MERGER_STRUCTURAL_REVIEW';
  } else if (
    /회사분할결정/.test(title)
  ) {
    actionType = 'SPIN_OFF';
    classifierReason = 'TITLE_SPIN_OFF_DECISION';
  } else if (
    /회사합병결정/.test(title)
  ) {
    actionType = 'MERGER';
    classifierReason = 'TITLE_MERGER_DECISION';
  } else if (
    /유무상증자결정/.test(title) ||
    /유상증자결정/.test(title) ||
    /무상증자결정/.test(title)
  ) {
    actionType = 'RIGHTS_ISSUE';
    classifierReason = 'TITLE_CAPITAL_INCREASE_DECISION';
  }

  if (!actionType) {
    return null;
  }

  const reviewFlags = [];

  if (correctionHint(title)) {
    reviewFlags.push('CORRECTION_CHAIN_REQUIRED');
  }

  if (withdrawalHint(title)) {
    reviewFlags.push('WITHDRAWAL_CHAIN_REQUIRED');
  }

  if (otherEntityScopeHint(title)) {
    reviewFlags.push('OTHER_ENTITY_SCOPE_REVIEW_REQUIRED');
  }

  if (
    actionType === 'SPIN_OFF' &&
    /분할합병/.test(title)
  ) {
    reviewFlags.push('SPLIT_MERGER_REQUIRES_STRUCTURAL_REVIEW');
  }

  if (
    actionType === 'RIGHTS_ISSUE'
  ) {
    reviewFlags.push('RIGHTS_ISSUE_NOT_YET_PRODUCTION_CANONICALIZED');
  }

  return {
    actionType,
    classifierReason,
    reviewFlags,
  };
}

function readEnvFile(root) {
  const file = path.join(root, '.env.local');
  const parsed = {};

  if (!fs.existsSync(file)) {
    return parsed;
  }

  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');

  for (const line of text.split(/\r?\n/)) {
    const m =
      line.match(
        /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/,
      );

    if (!m) {
      continue;
    }

    let value = m[2];

    if (/^['"]/.test(value)) {
      const quote = value[0];
      const end = value.indexOf(quote, 1);

      if (end < 0) {
        continue;
      }

      value = value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }

    parsed[m[1]] = value;
  }

  return parsed;
}

function requireEnvironment(root) {
  const fileEnv = readEnvFile(root);

  function pick(names) {
    for (const name of names) {
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

    return '';
  }

  const dartKey =
    pick([
      'OPENDART_API_KEY',
      'OPEN_DART_API_KEY',
      'DART_API_KEY',
      'DART_KEY',
      'OPEN_DART_KEY',
    ]);

  const supabaseUrl =
    pick([
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_URL',
    ]).replace(/\/+$/, '');

  const serviceKey =
    pick([
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);

  if (!dartKey) {
    throw new Error('DART_API_KEY_REQUIRED');
  }

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL_REQUIRED');
  }

  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  }

  return {
    dartKey,
    supabaseUrl,
    serviceKey,
  };
}

async function readLatestCoverage(
  baseUrl,
  serviceKey,
) {
  const select = [
    'id',
    'provider',
    'provider_version',
    'start_date',
    'end_date',
    'coverage_status',
    'is_validation',
    'production_applied',
    'created_at',
  ].join(',');

  const url =
    `${baseUrl}/rest/v1/corporate_action_source_coverage_windows` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&order=end_date.desc,created_at.desc` +
    `&limit=1`;

  const response =
    await fetch(
      url,
      {
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
        signal:
          AbortSignal.timeout(
            API_TIMEOUT_MS,
          ),
      },
    );

  if (!response.ok) {
    throw new Error(
      `SUPABASE_COVERAGE_HTTP_${response.status}`,
    );
  }

  const body =
    await response.json();

  if (!Array.isArray(body)) {
    throw new Error(
      'SUPABASE_COVERAGE_RESPONSE_INVALID',
    );
  }

  return body[0] ?? null;
}

async function requestDartList({
  key,
  corpCls,
  startDate,
  endDate,
  pageNo,
}) {
  const url =
    new URL(
      'https://opendart.fss.or.kr/api/list.json',
    );

  url.search =
    new URLSearchParams({
      crtfc_key:
        key,

      bgn_de:
        compactDate(
          startDate,
        ),

      end_de:
        compactDate(
          endDate,
        ),

      corp_cls:
        corpCls,

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
        redirect: 'error',
        cache: 'no-store',
        signal:
          AbortSignal.timeout(
            API_TIMEOUT_MS,
          ),
      },
    );

  if (!response.ok) {
    throw new Error(
      `DART_HTTP_${response.status}`,
    );
  }

  const text =
    await response.text();

  let body;

  try {
    body =
      JSON.parse(
        text.replace(
          /^\uFEFF/,
          '',
        ),
      );
  } catch {
    throw new Error(
      'DART_LIST_INVALID_JSON',
    );
  }

  if (
    !body ||
    typeof body !==
      'object' ||
    Array.isArray(body) ||
    !/^\d{3}$/.test(
      String(
        body.status ??
        '',
      ),
    )
  ) {
    throw new Error(
      'DART_LIST_INVALID_ENVELOPE',
    );
  }

  if (
    body.status ===
    '013'
  ) {
    return {
      status:
        '013',

      totalCount:
        0,

      totalPage:
        0,

      pageNo,

      rows:
        [],

      responseSha256:
        sha256(text),
    };
  }

  if (
    body.status !==
    '000'
  ) {
    throw new Error(
      `DART_STATUS_${body.status}`,
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

  const totalCount =
    Number(
      body.total_count ??
      0,
    );

  const totalPage =
    Number(
      body.total_page ??
      0,
    );

  if (
    !Number.isInteger(
      totalCount,
    ) ||
    totalCount <
      0 ||
    !Number.isInteger(
      totalPage,
    ) ||
    totalPage <
      0
  ) {
    throw new Error(
      'DART_LIST_PAGINATION_INVALID',
    );
  }

  const rows =
    body.list.map(
      (row) => ({
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
            corpCls,
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

        filerName:
          String(
            row.flr_nm ??
            '',
          ).trim(),

        receiptDate:
          String(
            row.rcept_dt ??
            '',
          ).trim(),

        remark:
          String(
            row.rm ??
            '',
          ).trim(),
      }),
    );

  for (const row of rows) {
    if (
      !/^\d{8}$/.test(
        row.corpCode,
      ) ||
      !/^\d{14}$/.test(
        row.receiptNo,
      ) ||
      !/^\d{8}$/.test(
        row.receiptDate,
      ) ||
      (
        row.stockCode !==
          null &&
        !/^[0-9A-Z]{6}$/.test(
          row.stockCode,
        )
      )
    ) {
      throw new Error(
        'DART_LIST_ROW_IDENTITY_INVALID',
      );
    }
  }

  return {
    status:
      '000',

    totalCount,
    totalPage,
    pageNo,

    rows,

    responseSha256:
      sha256(text),
  };
}

function atomicSave(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
  );

  const tmp =
    `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      value,
      null,
      2,
    ),
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function identityOf(row) {
  return [
    row.receiptNo,
    row.corpCode,
    row.corpCls,
  ].join('|');
}

function buildCandidate(row, market) {
  const classification =
    classifyCandidate(
      row.reportName,
    );

  if (!classification) {
    return null;
  }

  return {
    corpCode:
      row.corpCode,

    corpName:
      row.corpName,

    stockCode:
      row.stockCode,

    market,

    receiptNo:
      row.receiptNo,

    receiptDate:
      row.receiptDate,

    reportName:
      row.reportName,

    filerName:
      row.filerName,

    remark:
      row.remark,

    candidateActionType:
      classification.actionType,

    classifierReason:
      classification.classifierReason,

    correctionOrWithdrawalHint:
      correctionHint(
        compactTitle(
          row.reportName,
        ),
      ) ||
      withdrawalHint(
        compactTitle(
          row.reportName,
        ),
      ),

    reviewFlags:
      classification.reviewFlags,
  };
}

function stateFingerprint({
  startDate,
  throughDate,
}) {
  return sha256(
    JSON.stringify({
      version:
        VERSION,

      classifierVersion:
        CLASSIFIER_VERSION,

      provider:
        PROVIDER,

      providerVersion:
        PROVIDER_VERSION,

      startDate,
      throughDate,

      markets:
        MARKET_CLASSES,

      actionTypes:
        ACTION_TYPES,

      pageCount:
        PAGE_COUNT,
    }),
  );
}

function summarize(state) {
  const candidateCounts =
    Object.fromEntries(
      ACTION_TYPES.map(
        (type) => [
          type,
          state.candidates.filter(
            (candidate) =>
              candidate.candidateActionType ===
              type,
          ).length,
        ],
      ),
    );

  const marketCounts =
    Object.fromEntries(
      MARKET_CLASSES.map(
        ({ market }) => [
          market,
          state.disclosures.filter(
            (row) =>
              row.market ===
              market,
          ).length,
        ],
      ),
    );

  return {
    disclosures:
      state.disclosures.length,

    candidates:
      state.candidates.length,

    candidateCounts,
    marketCounts,

    correctionOrWithdrawalCandidates:
      state.candidates.filter(
        (candidate) =>
          candidate.correctionOrWithdrawalHint,
      ).length,

    otherEntityScopeCandidates:
      state.candidates.filter(
        (candidate) =>
          candidate.reviewFlags.includes(
            'OTHER_ENTITY_SCOPE_REVIEW_REQUIRED',
          ),
      ).length,

    pagesFetched:
      state.pages.length,

    duplicateDisclosureIdentities:
      state.duplicateDisclosureIdentities.length,
  };
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

  const env =
    requireEnvironment(
      root,
    );

  const throughDate =
    parseSqlDate(
      args.through ??
      koreanToday(),
      'THROUGH',
    );

  const coverage =
    await readLatestCoverage(
      env.supabaseUrl,
      env.serviceKey,
    );

  let startDate;

  if (
    args.start
  ) {
    startDate =
      parseSqlDate(
        args.start,
        'START',
      );
  } else {
    if (
      !coverage ||
      !coverage.end_date
    ) {
      throw new Error(
        'NO_PRIOR_COVERAGE_USE_EXPLICIT_START',
      );
    }

    startDate =
      addCalendarDays(
        parseSqlDate(
          coverage.end_date,
          'COVERAGE_END',
        ),
        1,
      );
  }

  if (
    startDate >
    throughDate
  ) {
    const report = {
      version:
        VERSION,

      status:
        'NO_NEW_INCREMENTAL_WINDOW',

      provider:
        PROVIDER,

      providerVersion:
        PROVIDER_VERSION,

      classifierVersion:
        CLASSIFIER_VERSION,

      latestCoverage:
        coverage,

      startDate,
      throughDate,

      writesPerformed:
        0,

      dartRequests:
        0,
    };

    console.log(
      JSON.stringify(
        report,
        null,
        2,
      ),
    );

    return;
  }

  const fingerprint =
    stateFingerprint({
      startDate,
      throughDate,
    });

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-incremental-v9-11-1.json',
      ),
    );

  let state = {
    version:
      VERSION,

    status:
      'RUNNING',

    provider:
      PROVIDER,

    providerVersion:
      PROVIDER_VERSION,

    classifierVersion:
      CLASSIFIER_VERSION,

    fingerprint,

    latestCoverage:
      coverage,

    startDate,
    throughDate,

    markets:
      MARKET_CLASSES,

    actionTypes:
      ACTION_TYPES,

    pages:
      [],

    disclosures:
      [],

    candidates:
      [],

    duplicateDisclosureIdentities:
      [],

    startedAt:
      new Date()
        .toISOString(),

    finishedAt:
      null,

    writesPerformed:
      0,

    productionApplied:
      false,

    eventImportComplete:
      false,
  };

  if (
    fs.existsSync(
      outputFile,
    ) &&
    !args.refresh
  ) {
    const prior =
      JSON.parse(
        fs.readFileSync(
          outputFile,
          'utf8',
        ).replace(
          /^\uFEFF/,
          '',
        ),
      );

    if (
      prior.version !==
        VERSION ||
      prior.fingerprint !==
        fingerprint
    ) {
      throw new Error(
        'INCREMENTAL_STATE_MISMATCH_USE_REFRESH_OR_DIFFERENT_OUTPUT',
      );
    }

    state =
      prior;

    state.status =
      'RUNNING';
  }

  if (
    args.refresh
  ) {
    atomicSave(
      outputFile,
      state,
    );
  }

  const disclosureMap =
    new Map(
      state.disclosures.map(
        (row) => [
          identityOf(row),
          row,
        ],
      ),
    );

  const candidateMap =
    new Map(
      state.candidates.map(
        (candidate) => [
          `${candidate.receiptNo}|${candidate.candidateActionType}`,
          candidate,
        ],
      ),
    );

  for (
    const marketSpec of
    MARKET_CLASSES
  ) {
    let pageNo = 1;
    let totalPage = null;

    while (
      totalPage ===
        null ||
      pageNo <=
        totalPage
    ) {
      const existingPage =
        state.pages.find(
          (page) =>
            page.corpCls ===
              marketSpec.corpCls &&
            page.pageNo ===
              pageNo &&
            page.status ===
              'SUCCESS',
        );

      if (
        existingPage &&
        !args.refresh
      ) {
        totalPage =
          existingPage.totalPage;

        pageNo +=
          1;

        continue;
      }

      const page =
        await requestDartList({
          key:
            env.dartKey,

          corpCls:
            marketSpec.corpCls,

          startDate,
          endDate:
            throughDate,

          pageNo,
        });

      totalPage =
        page.totalPage;

      const normalizedPageRows =
        page.rows.map(
          (row) => ({
            ...row,
            market:
              marketSpec.market,
          }),
        );

      for (
        const row of
        normalizedPageRows
      ) {
        const identity =
          identityOf(
            row,
          );

        if (
          disclosureMap.has(
            identity,
          )
        ) {
          const previous =
            disclosureMap.get(
              identity,
            );

          if (
            JSON.stringify(
              previous,
            ) !==
            JSON.stringify(
              row,
            )
          ) {
            state
              .duplicateDisclosureIdentities
              .push({
                identity,
                prior:
                  previous,
                incoming:
                  row,
              });
          }
        } else {
          disclosureMap.set(
            identity,
            row,
          );

          state
            .disclosures
            .push(
              row,
            );
        }

        const candidate =
          buildCandidate(
            row,
            marketSpec.market,
          );

        if (
          candidate
        ) {
          const candidateIdentity =
            `${candidate.receiptNo}|${candidate.candidateActionType}`;

          if (
            !candidateMap.has(
              candidateIdentity,
            )
          ) {
            candidateMap.set(
              candidateIdentity,
              candidate,
            );

            state
              .candidates
              .push(
                candidate,
              );
          }
        }
      }

      const pageRecord = {
        corpCls:
          marketSpec.corpCls,

        market:
          marketSpec.market,

        pageNo,

        totalPage:
          page.totalPage,

        totalCount:
          page.totalCount,

        rowCount:
          page.rows.length,

        responseSha256:
          page.responseSha256,

        fetchedAt:
          new Date()
            .toISOString(),

        status:
          'SUCCESS',
      };

      const priorPageIndex =
        state.pages.findIndex(
          (entry) =>
            entry.corpCls ===
              marketSpec.corpCls &&
            entry.pageNo ===
              pageNo,
        );

      if (
        priorPageIndex >=
        0
      ) {
        state.pages[
          priorPageIndex
        ] =
          pageRecord;
      } else {
        state.pages.push(
          pageRecord,
        );
      }

      state.summary =
        summarize(
          state,
        );

      atomicSave(
        outputFile,
        state,
      );

      console.log(
        [
          'RUNNING',
          `market=${marketSpec.market}`,
          `page=${pageNo}/${Math.max(totalPage, 1)}`,
          `disclosures=${state.summary.disclosures}`,
          `candidates=${state.summary.candidates}`,
        ].join(' '),
      );

      pageNo +=
        1;

      if (
        totalPage >
        0 &&
        pageNo <=
          totalPage
      ) {
        await sleep(
          REQUEST_DELAY_MS,
        );
      }
    }
  }

  if (
    state
      .duplicateDisclosureIdentities
      .length >
    0
  ) {
    state.status =
      'FAILED_DUPLICATE_IDENTITY_CONFLICT';
  } else {
    state.status =
      'INCREMENTAL_INVENTORY_COMPLETE';
  }

  state.finishedAt =
    new Date()
      .toISOString();

  state.summary =
    summarize(
      state,
    );

  state.coverageCandidate = {
    provider:
      PROVIDER,

    providerVersion:
      PROVIDER_VERSION,

    universeCode:
      'KRX_KOSPI_KOSDAQ',

    startDate,
    endDate:
      throughDate,

    coverageStatus:
      'INVENTORY_COMPLETE',

    productionApplied:
      false,

    eventImportComplete:
      false,

    candidateClassificationExhaustive:
      false,

    note:
      'Read-only incremental disclosure inventory. Do not advance coverage in DB until downstream detail parsing/canonical production ingestion is proven.',
  };

  atomicSave(
    outputFile,
    state,
  );

  console.log(
    JSON.stringify(
      {
        status:
          state.status,

        version:
          VERSION,

        startDate,
        throughDate,

        latestCoverageEndDate:
          coverage?.end_date ??
          null,

        ...state.summary,

        writesPerformed:
          0,

        productionApplied:
          false,

        outputFile,
      },
      null,
      2,
    ),
  );

  if (
    state.status !==
    'INCREMENTAL_INVENTORY_COMPLETE'
  ) {
    process.exitCode =
      1;
  }
}

main().catch(
  (error) => {
    console.error(
      safeError(
        error,
      ),
    );

    process.exitCode =
      1;
  },
);
