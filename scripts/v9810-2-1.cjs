/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.10.2.1 - Structural evidence path + exact label probe
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-structural-date-audit-v9-8-10-1.json
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *
 * Output:
 *   logs/opendart-corporate-action-structural-date-probe-v9-8-10-2-1.json
 *
 * Fixes V9.8.10.2 structured-data path:
 *   evidenceRow.structured.file -> JSON -> body.list
 *
 * Structured matching:
 *   1) exact source receipt
 *   2) exact canonical root/providerEventId
 *   3) all rows (diagnostic only)
 *
 * XML:
 *   exact structural label occurrences + nearby dates
 *
 * No canonical dates are promoted.
 *
 * Run:
 *   node .\scripts\v9810-2-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_10_2_1_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';

const AUDIT_VERSION =
  'V9_8_10_1_STRUCTURAL_CANONICAL_DATE_AUDIT';

const EVIDENCE_VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const MAX_ZIP_ENTRIES = 64;
const MAX_XML_BYTES = 16 * 1024 * 1024;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseDate(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();

  const match =
    text.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/) ??
    text.match(/\b(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ??
    text.match(/\b(20\d{2})(\d{2})(\d{2})\b/);

  if (!match) return null;

  const iso =
    `${String(match[1]).padStart(4, '0')}-` +
    `${String(match[2]).padStart(2, '0')}-` +
    `${String(match[3]).padStart(2, '0')}`;

  const date = new Date(`${iso}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso
  )
    ? iso
    : null;
}

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - 65557);

  for (let p = bytes.length - 22; p >= min; p -= 1) {
    if (bytes.readUInt32LE(p) !== 0x06054b50) continue;

    const commentLen = bytes.readUInt16LE(p + 20);
    if (p + 22 + commentLen !== bytes.length) continue;

    const count = bytes.readUInt16LE(p + 10);
    const cdSize = bytes.readUInt32LE(p + 12);
    const cdOffset = bytes.readUInt32LE(p + 16);

    if (!count || count > MAX_ZIP_ENTRIES) {
      throw new Error('ZIP_ENTRY_LIMIT');
    }

    if (cdOffset + cdSize !== p) {
      throw new Error('INVALID_CENTRAL_DIRECTORY');
    }

    return { count, cdOffset };
  }

  throw new Error('ZIP_EOCD_NOT_FOUND');
}

function readZipEntries(bytes) {
  const eocd = findEocd(bytes);
  const entries = [];
  let p = eocd.cdOffset;

  for (let i = 0; i < eocd.count; i += 1) {
    if (bytes.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('INVALID_CENTRAL_ENTRY');
    }

    const method = bytes.readUInt16LE(p + 10);
    const compressedSize = bytes.readUInt32LE(p + 20);
    const uncompressedSize = bytes.readUInt32LE(p + 24);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const localOffset = bytes.readUInt32LE(p + 42);

    if (uncompressedSize > MAX_XML_BYTES) {
      throw new Error('XML_TOO_LARGE');
    }

    const nameStart = p + 46;
    const nameEnd = nameStart + nameLen;
    const name = bytes.subarray(nameStart, nameEnd).toString('utf8');

    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('INVALID_LOCAL_ENTRY');
    }

    const localNameLen = bytes.readUInt16LE(localOffset + 26);
    const localExtraLen = bytes.readUInt16LE(localOffset + 28);

    const dataStart =
      localOffset + 30 + localNameLen + localExtraLen;

    const dataEnd = dataStart + compressedSize;
    const compressed = bytes.subarray(dataStart, dataEnd);

    let raw = null;

    if (method === 0) {
      raw = Buffer.from(compressed);
    } else if (method === 8) {
      raw = zlib.inflateRawSync(compressed, {
        maxOutputLength: MAX_XML_BYTES,
      });
    }

    if (raw) {
      entries.push({ name, bytes: raw });
    }

    p = nameEnd + extraLen + commentLen;
  }

  return entries;
}

function decodeXmlBytes(bytes) {
  const head = bytes
    .subarray(0, Math.min(bytes.length, 512))
    .toString('latin1');

  const match = head.match(/encoding\s*=\s*["']([^"']+)["']/i);
  const declared = String(match?.[1] ?? '').toLowerCase();

  const candidates = [];

  if (
    declared.includes('euc-kr') ||
    declared.includes('ks_c_5601') ||
    declared.includes('ksc5601')
  ) {
    candidates.push('euc-kr');
  }

  candidates.push('utf-8', 'euc-kr');

  for (const encoding of [...new Set(candidates)]) {
    try {
      return new TextDecoder(encoding, { fatal: false }).decode(bytes);
    } catch {
      // continue
    }
  }

  return bytes.toString('utf8');
}

function decodeEntities(s) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return String(s).replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, key) => {
      if (key[0] === '#') {
        const n =
          key[1].toLowerCase() === 'x'
            ? parseInt(key.slice(2), 16)
            : parseInt(key.slice(1), 10);

        return Number.isFinite(n)
          ? String.fromCodePoint(n)
          : match;
      }

      return named[key.toLowerCase()] ?? match;
    },
  );
}

function xmlTextNodes(xml) {
  const cleaned = String(xml)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '>$1<');

  const nodes = [];

  for (const match of cleaned.matchAll(/>([^<>]+)</g)) {
    const text = decodeEntities(match[1])
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) nodes.push(text);
  }

  return nodes;
}

function extractNodesFromZip(file) {
  const bytes = fs.readFileSync(file);

  const entries = readZipEntries(bytes)
    .filter((entry) => /\.xml$/i.test(entry.name))
    .sort((a, b) => b.bytes.length - a.bytes.length);

  if (!entries.length) {
    throw new Error('XML_ENTRY_MISSING');
  }

  const entry = entries[0];
  const xml = decodeXmlBytes(entry.bytes);

  return {
    entryName: entry.name,
    xmlSha256: sha256(entry.bytes),
    nodes: xmlTextNodes(xml),
  };
}

function labelOccurrences(nodes, regex, lookahead = 5) {
  const out = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const text = String(nodes[i]).replace(/\s+/g, ' ').trim();

    if (!regex.test(text)) continue;

    const following = nodes.slice(i + 1, i + 1 + lookahead);
    const dates = following
      .map((value) => ({
        raw: value,
        date: parseDate(value),
      }))
      .filter((row) => row.date);

    out.push({
      index: i,
      label: text,
      following,
      dates,
    });
  }

  return out;
}

function distinctDates(occurrences) {
  return [
    ...new Set(
      occurrences.flatMap((row) =>
        row.dates.map((dateRow) => dateRow.date),
      ),
    ),
  ].sort();
}

function compactStructuredRow(row) {
  const fields = {};

  for (const [key, value] of Object.entries(row ?? {})) {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'object'
    ) {
      continue;
    }

    const text = String(value).replace(/\s+/g, ' ').trim();

    if (
      /^(rcept_no|corp_code|corp_name|bddd|mgsc_bddd|mgsc_mgdt|mgdt|mgsc_ergmd|ergmd|mgsc_mgrgsprd|mgrgsprd|mgsc_nstkdlprd|nstkdlprd|mgsc_nstklstprd|nstklstprd|mgsc_mgctrd|mgsc_shddstd|mgsc_cdobprpd_bgd|mgsc_cdobprpd_edd)$/i.test(
        key,
      ) ||
      parseDate(text)
    ) {
      fields[key] =
        text.length > 300
          ? `${text.slice(0, 300)}…`
          : text;
    }
  }

  return fields;
}

function dateFieldValues(rows, names) {
  const out = [];

  for (const row of rows) {
    for (const name of names) {
      const raw = row?.[name];
      const date = parseDate(raw);

      if (date) {
        out.push({
          rceptNo: String(row?.rcept_no ?? ''),
          field: name,
          raw: String(raw),
          date,
        });
      }
    }
  }

  return out;
}

function consensus(values) {
  const distinct = [...new Set(values.map((row) => row.date))].sort();

  return {
    distinctDates: distinct,
    unique: distinct.length === 1,
    value: distinct.length === 1 ? distinct[0] : null,
  };
}

function main() {
  const root = path.resolve(__dirname, '..');

  const auditFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-audit-v9-8-10-1.json',
  );

  const evidenceFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-detail-evidence-v9-8-3-1.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-probe-v9-8-10-2-1.json',
  );

  for (const file of [auditFile, evidenceFile]) {
    if (!fs.existsSync(file)) {
      throw new Error(`INPUT_NOT_FOUND:${path.basename(file)}`);
    }
  }

  const audit = readJson(auditFile);
  const evidence = readJson(evidenceFile);

  if (audit.version !== AUDIT_VERSION) {
    throw new Error('AUDIT_VERSION_MISMATCH');
  }

  if (evidence.version !== EVIDENCE_VERSION) {
    throw new Error('EVIDENCE_VERSION_MISMATCH');
  }

  if (!Array.isArray(audit.reviewQueue)) {
    throw new Error('AUDIT_REVIEW_QUEUE_MISSING');
  }

  const evidenceByReceipt = new Map(
    evidence.results.map((row) => [row.receiptNo, row]),
  );

  const rows = [];

  for (let i = 0; i < audit.reviewQueue.length; i += 1) {
    const target = audit.reviewQueue[i];
    const evidenceRow =
      evidenceByReceipt.get(target.sourceReceiptNo) ?? null;

    const structuredRel =
      evidenceRow?.structured?.file ?? null;

    const structuredAbs =
      structuredRel
        ? path.join(root, structuredRel)
        : null;

    let structuredProbe = {
      file: structuredRel,
      available: false,
      responseRows: 0,
      exactSourceRows: 0,
      exactRootRows: 0,
      sourcePrimaryDateConsensus: null,
      rootPrimaryDateConsensus: null,
      allPrimaryDateConsensus: null,
      exactSource: [],
      exactRoot: [],
      allRowsCompact: [],
    };

    if (
      structuredAbs &&
      fs.existsSync(structuredAbs)
    ) {
      const body = readJson(structuredAbs);
      const list = Array.isArray(body?.list) ? body.list : [];

      const exactSource = list.filter(
        (row) =>
          String(row?.rcept_no ?? '') ===
          String(target.sourceReceiptNo),
      );

      const exactRoot = list.filter(
        (row) =>
          String(row?.rcept_no ?? '') ===
          String(target.providerEventId),
      );

      const primaryNames =
        target.actionType === 'MERGER'
          ? ['mgsc_mgdt', 'mgdt']
          : ['dvdt', 'dv_dt', 'dvsc_dvdt', 'dvmg_dt'];

      const sourceValues = dateFieldValues(
        exactSource,
        primaryNames,
      );

      const rootValues = dateFieldValues(
        exactRoot,
        primaryNames,
      );

      const allValues = dateFieldValues(
        list,
        primaryNames,
      );

      structuredProbe = {
        file: structuredRel,
        available: true,
        responseRows: list.length,
        exactSourceRows: exactSource.length,
        exactRootRows: exactRoot.length,
        sourcePrimaryDateFields: sourceValues,
        rootPrimaryDateFields: rootValues,
        allPrimaryDateFields: allValues,
        sourcePrimaryDateConsensus: consensus(sourceValues),
        rootPrimaryDateConsensus: consensus(rootValues),
        allPrimaryDateConsensus: consensus(allValues),
        exactSource: exactSource.map(compactStructuredRow),
        exactRoot: exactRoot.map(compactStructuredRow),
        allRowsCompact: list.map(compactStructuredRow),
      };
    }

    const documentRel =
      evidenceRow?.document?.file ?? null;

    const documentAbs =
      documentRel
        ? path.join(root, documentRel)
        : null;

    let documentProbe = {
      file: documentRel,
      available: false,
    };

    if (
      documentAbs &&
      fs.existsSync(documentAbs)
    ) {
      try {
        const extracted =
          extractNodesFromZip(documentAbs);

        const mergerDateLabels =
          target.actionType === 'MERGER'
            ? labelOccurrences(
                extracted.nodes,
                /^(?:합병기일|합병예정일|합병 예정일|합병일|합병일자)$/,
                5,
              )
            : labelOccurrences(
                extracted.nodes,
                /^(?:분할기일|분할합병기일|분할예정일|분할 예정일)$/,
                5,
              );

        const boardLabels = labelOccurrences(
          extracted.nodes,
          /^(?:이사회결의일|이사회결의일자|이사회 결의일|이사회 결의일자)$/,
          5,
        );

        const registrationLabels =
          target.actionType === 'MERGER'
            ? labelOccurrences(
                extracted.nodes,
                /^(?:합병등기예정일|합병등기일|합병등기 예정일)$/,
                5,
              )
            : labelOccurrences(
                extracted.nodes,
                /^(?:분할등기예정일|분할등기일|분할등기 예정일)$/,
                5,
              );

        const listingLabels = labelOccurrences(
          extracted.nodes,
          /^(?:신주상장예정일|신주상장일|신주권상장예정일|변경상장예정일)$/,
          5,
        );

        documentProbe = {
          file: documentRel,
          available: true,
          entryName: extracted.entryName,
          xmlSha256: extracted.xmlSha256,
          textNodeCount: extracted.nodes.length,
          primaryDateOccurrences: mergerDateLabels,
          primaryDateDistinctDates: distinctDates(mergerDateLabels),
          boardDecisionOccurrences: boardLabels,
          boardDecisionDistinctDates: distinctDates(boardLabels),
          registrationOccurrences: registrationLabels,
          registrationDistinctDates: distinctDates(registrationLabels),
          listingOccurrences: listingLabels,
          listingDistinctDates: distinctDates(listingLabels),
        };
      } catch (error) {
        documentProbe = {
          file: documentRel,
          available: true,
          parseError: String(error?.message ?? error),
        };
      }
    }

    const structuredRootConsensus =
      structuredProbe?.rootPrimaryDateConsensus?.value ?? null;

    const structuredSourceConsensus =
      structuredProbe?.sourcePrimaryDateConsensus?.value ?? null;

    const xmlPrimaryDates =
      documentProbe?.primaryDateDistinctDates ?? [];

    let strongestCandidate = null;
    let candidateBasis = null;

    if (structuredSourceConsensus) {
      strongestCandidate = structuredSourceConsensus;
      candidateBasis = 'STRUCTURED_EXACT_SOURCE_RECEIPT';
    } else if (structuredRootConsensus) {
      strongestCandidate = structuredRootConsensus;
      candidateBasis = 'STRUCTURED_EXACT_CANONICAL_ROOT_RECEIPT';
    } else if (xmlPrimaryDates.length === 1) {
      strongestCandidate = xmlPrimaryDates[0];
      candidateBasis = 'XML_EXACT_PRIMARY_LABEL_UNIQUE_DATE';
    }

    rows.push({
      providerEventId: target.providerEventId,
      sourceReceiptNo: target.sourceReceiptNo,
      stockCode: target.stockCode,
      actionType: target.actionType,
      sourceKind: target.sourceKind,
      parserStatus: target.parserStatus,
      previousPrimaryDateCandidate:
        target.primaryDateCandidate,
      previousChronologyWarnings:
        target.chronologyWarnings,
      evidenceDisposition:
        evidenceRow?.evidenceDisposition ?? null,
      structuredProbe,
      documentProbe,
      strongestCandidate,
      candidateBasis,
    });

    console.log(
      [
        'STRUCTURAL_PROBE_FIXED',
        `${i + 1}/${audit.reviewQueue.length}`,
        `root=${target.providerEventId}`,
        `stock=${target.stockCode}`,
        `source=${target.sourceKind}`,
        `structuredFile=${structuredProbe.available}`,
        `rows=${structuredProbe.responseRows ?? 0}`,
        `srcExact=${structuredProbe.exactSourceRows ?? 0}`,
        `rootExact=${structuredProbe.exactRootRows ?? 0}`,
        `xmlDates=${(documentProbe.primaryDateDistinctDates ?? []).join(',') || '-'}`,
        `candidate=${strongestCandidate ?? '-'}`,
        `basis=${candidateBasis ?? '-'}`,
      ].join(' '),
    );
  }

  const candidateReady = rows.filter(
    (row) => row.strongestCandidate !== null,
  );

  const unresolved = rows.filter(
    (row) => row.strongestCandidate === null,
  );

  const status =
    rows.length !== audit.reviewQueue.length
      ? 'STRUCTURAL_EVIDENCE_PATH_PROBE_COUNT_MISMATCH'
      : unresolved.length === 0
        ? 'STRUCTURAL_EVIDENCE_PATH_PROBE_COMPLETE'
        : 'STRUCTURAL_EVIDENCE_PATH_PROBE_COMPLETE_WITH_REVIEW';

  const report = {
    version: VERSION,
    status,

    source: {
      auditVersion: audit.version,
      auditFingerprint: audit.outputFingerprint,
      evidenceVersion: evidence.version,
    },

    counts: {
      reviewTargets: audit.reviewQueue.length,
      outputRows: rows.length,
      structuredFilesAvailable: rows.filter(
        (row) => row.structuredProbe.available,
      ).length,
      documentFilesAvailable: rows.filter(
        (row) => row.documentProbe.available,
      ).length,
      exactSourceStructuredMatches: rows.filter(
        (row) =>
          (row.structuredProbe.exactSourceRows ?? 0) > 0,
      ).length,
      exactRootStructuredMatches: rows.filter(
        (row) =>
          (row.structuredProbe.exactRootRows ?? 0) > 0,
      ).length,
      strongestCandidateReady: candidateReady.length,
      unresolvedAfterProbe: unresolved.length,
    },

    candidateBasisCounts: Object.fromEntries(
      [...new Set(
        candidateReady.map((row) => row.candidateBasis),
      )]
        .sort()
        .map((basis) => [
          basis,
          candidateReady.filter(
            (row) => row.candidateBasis === basis,
          ).length,
        ]),
    ),

    unresolvedRows: unresolved.map(
      (row) => ({
        providerEventId: row.providerEventId,
        sourceReceiptNo: row.sourceReceiptNo,
        stockCode: row.stockCode,
        actionType: row.actionType,
        sourceKind: row.sourceKind,
        structuredAvailable:
          row.structuredProbe.available,
        structuredResponseRows:
          row.structuredProbe.responseRows ?? 0,
        exactSourceRows:
          row.structuredProbe.exactSourceRows ?? 0,
        exactRootRows:
          row.structuredProbe.exactRootRows ?? 0,
        xmlPrimaryDates:
          row.documentProbe.primaryDateDistinctDates ?? [],
      }),
    ),

    rows,

    safety: {
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      productionApplied: false,
      canonicalEventsCreated: 0,
      structuralEffectiveDatesPromoted: 0,
      coverageWindowAdvanced: false,
    },

    outputFile: path
      .relative(root, outputFile)
      .replaceAll('\\', '/'),
  };

  report.outputFingerprint = sha256(
    JSON.stringify({
      version: report.version,
      auditFingerprint:
        report.source.auditFingerprint,
      rows: rows.map(
        (row) => [
          row.providerEventId,
          row.sourceReceiptNo,
          row.strongestCandidate,
          row.candidateBasis,
          row.structuredProbe.exactSourceRows,
          row.structuredProbe.exactRootRows,
          row.documentProbe.primaryDateDistinctDates ?? [],
        ],
      ),
    }),
  );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: VERSION,
        ...report.counts,
        candidateBasisCounts:
          report.candidateBasisCounts,
        unresolvedRows:
          report.unresolvedRows,
        networkRequests: 0,
        databaseWrites: 0,
        productionApplied: false,
        canonicalEventsCreated: 0,
        structuralEffectiveDatesPromoted: 0,
        coverageWindowAdvanced: false,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'STRUCTURAL_EVIDENCE_PATH_PROBE_COUNT_MISMATCH'
  ) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    String(error?.message ?? error),
  );

  process.exitCode = 1;
}
