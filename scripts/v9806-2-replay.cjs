/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.6.2 - Remaining reverse-split XML structure probe
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-field-extraction-v9-8-6-1-replay.json
 *   logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json
 *   logs/opendart-corporate-action-canonical-source-selection-v9-8-5-1-replay.json
 *
 * Output:
 *   logs/opendart-corporate-action-reverse-split-probe-v9-8-6-2-replay.json
 *
 * Purpose:
 *   Diagnose only the 5 remaining REVERSE_SPLIT rows:
 *     - 4 SPLIT_MAIN_TABLE_NOT_FOUND
 *     - 1 DOCUMENT_XML_FILE_UNAVAILABLE
 *
 * For each row:
 *   - inspect every available document in the canonical chain
 *   - preserve XML text-node order
 *   - capture nodes around "병합", "액면", "발행주식총수", "효력", "상장"
 *   - detect likely alternate table headings / field labels
 *   - identify whether an earlier chain member has usable XML
 *
 * No event values are persisted or promoted.
 *
 * Run:
 *   node .\scripts\v9806-2.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_6_2_REPLAY_REMAINING_REVERSE_SPLIT_XML_STRUCTURE_PROBE';

const INPUT_VERSION =
  'V9_8_6_1_REPLAY_PROVEN_XML_TEXT_NODE_FIELD_EXTRACTION';

const EVIDENCE_VERSION =
  'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION';

const SOURCE_VERSION =
  'V9_8_5_1_REPLAY_WITHDRAWAL_CONTROL_ACCOUNTING_FIX';

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
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function parseArgs(argv) {
  const out = {
    input: null,
    evidence: null,
    source: null,
    output: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      out.input = arg.slice('--input='.length);
    } else if (arg.startsWith('--evidence=')) {
      out.evidence = arg.slice('--evidence='.length);
    } else if (arg.startsWith('--source=')) {
      out.source = arg.slice('--source='.length);
    } else if (arg.startsWith('--output=')) {
      out.output = arg.slice('--output='.length);
    } else {
      throw new Error(`UNKNOWN_OPTION:${arg}`);
    }
  }

  return out;
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

    const flags = bytes.readUInt16LE(p + 8);
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
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;

    const compressed = bytes.subarray(dataStart, dataEnd);

    let raw = null;
    if (method === 0) raw = Buffer.from(compressed);
    if (method === 8) {
      raw = zlib.inflateRawSync(compressed, {
        maxOutputLength: MAX_XML_BYTES,
      });
    }

    if (raw) entries.push({ name, bytes: raw });

    p = nameEnd + extraLen + commentLen;
  }

  return entries;
}

function decodeXmlBytes(bytes) {
  const head = bytes
    .subarray(0, Math.min(bytes.length, 512))
    .toString('latin1');

  const match = head.match(
    /encoding\s*=\s*["']([^"']+)["']/i,
  );

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
      return new TextDecoder(
        encoding,
        { fatal: false },
      ).decode(bytes);
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

function relevantNodeIndexes(nodes) {
  const regex =
    /주식\s*병합|병합\s*내용|액면|1주당\s*가액|발행주식총수|보통주식|효력발생|상장예정|신주권|매매거래정지|기준일/i;

  const indexes = [];

  for (let i = 0; i < nodes.length; i += 1) {
    if (regex.test(nodes[i])) indexes.push(i);
  }

  return indexes;
}

function compactWindows(nodes, indexes, radius = 5) {
  const ranges = [];

  for (const index of indexes) {
    const start = Math.max(0, index - radius);
    const end = Math.min(nodes.length - 1, index + radius);

    const previous = ranges.at(-1);

    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((range) => ({
    startIndex: range.start,
    endIndex: range.end,
    nodes: nodes
      .slice(range.start, range.end + 1)
      .map((text, offset) => ({
        index: range.start + offset,
        text,
      })),
  }));
}

function findHeadingCandidates(nodes) {
  const patterns = [
    /주식\s*병합.*내용/i,
    /병합.*내용/i,
    /^1\..*병합/i,
    /주식\s*병합/i,
  ];

  const rows = [];

  for (let i = 0; i < nodes.length; i += 1) {
    for (const pattern of patterns) {
      if (pattern.test(nodes[i])) {
        rows.push({
          index: i,
          text: nodes[i],
          pattern: String(pattern),
        });
        break;
      }
    }
  }

  return rows.slice(0, 30);
}

function findLabelCandidates(nodes) {
  const labels = {
    parValue: /1주당.*가액|액면가액|1주의\s*금액/i,
    issuedShares: /발행주식총수/i,
    commonShares: /보통주식/i,
    effectiveDate: /효력발생일|병합기준일|기준일/i,
    listingDate: /상장예정일|신주권상장|신주상장/i,
  };

  const out = {};

  for (const [key, regex] of Object.entries(labels)) {
    out[key] = [];

    for (let i = 0; i < nodes.length; i += 1) {
      if (regex.test(nodes[i])) {
        out[key].push({
          index: i,
          text: nodes[i],
          following: nodes.slice(i + 1, i + 8),
        });
      }
    }
  }

  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const root = path.resolve(__dirname, '..');

  const inputFile = path.resolve(
    args.input ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-field-extraction-v9-8-6-1-replay.json',
      ),
  );

  const evidenceFile = path.resolve(
    args.evidence ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      ),
  );

  const sourceFile = path.resolve(
    args.source ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-canonical-source-selection-v9-8-5-1-replay.json',
      ),
  );

  const outputFile = path.resolve(
    args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-reverse-split-probe-v9-8-6-2-replay.json',
      ),
  );

  const input = readJson(inputFile);
  const evidence = readJson(evidenceFile);
  const source = readJson(sourceFile);

  if (input.version !== INPUT_VERSION) {
    throw new Error('INPUT_VERSION_MISMATCH');
  }

  if (evidence.version !== EVIDENCE_VERSION) {
    throw new Error('EVIDENCE_VERSION_MISMATCH');
  }

  if (source.version !== SOURCE_VERSION) {
    throw new Error('SOURCE_VERSION_MISMATCH');
  }

  const evidenceByReceipt = new Map(
    evidence.results.map((row) => [row.receiptNo, row]),
  );

  const chainByProviderEventId = new Map(
    source.activeChains.map((row) => [row.providerEventId, row]),
  );

  const targets = input.reviewQueue.filter(
    (row) => row.actionType === 'REVERSE_SPLIT',
  );

  const rows = [];

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];

    const chain =
      chainByProviderEventId.get(target.providerEventId) ??
      null;

    const receiptNos = [
      ...new Set([
        target.sourceReceiptNo,
        ...(chain?.memberReceiptNos ?? []),
      ]),
    ];

    const documents = [];

    for (const receiptNo of receiptNos) {
      const evidenceRow =
        evidenceByReceipt.get(receiptNo) ??
        null;

      const relFile =
        evidenceRow?.document?.file ??
        null;

      const absFile =
        relFile
          ? path.join(root, relFile)
          : null;

      if (
        !absFile ||
        !fs.existsSync(absFile)
      ) {
        documents.push({
          receiptNo,
          available: false,
          documentStatus:
            evidenceRow?.document?.status ??
            null,
          providerStatus:
            evidenceRow?.document?.providerStatus ??
            null,
          disposition:
            evidenceRow?.evidenceDisposition ??
            null,
        });

        continue;
      }

      try {
        const extracted =
          extractNodesFromZip(absFile);

        const indexes =
          relevantNodeIndexes(extracted.nodes);

        documents.push({
          receiptNo,
          available: true,
          documentStatus:
            evidenceRow?.document?.status ??
            null,
          disposition:
            evidenceRow?.evidenceDisposition ??
            null,
          file: relFile,
          entryName:
            extracted.entryName,
          xmlSha256:
            extracted.xmlSha256,
          textNodeCount:
            extracted.nodes.length,
          headingCandidates:
            findHeadingCandidates(extracted.nodes),
          labelCandidates:
            findLabelCandidates(extracted.nodes),
          relevantWindows:
            compactWindows(
              extracted.nodes,
              indexes,
              5,
            ).slice(0, 20),
        });
      } catch (error) {
        documents.push({
          receiptNo,
          available: true,
          file: relFile,
          parseError:
            String(error?.message ?? error),
        });
      }
    }

    const availableDocs =
      documents.filter((row) => row.available && !row.parseError);

    const alternateAvailable =
      availableDocs.filter(
        (row) =>
          row.receiptNo !== target.sourceReceiptNo,
      );

    rows.push({
      providerEventId:
        target.providerEventId,
      sourceReceiptNo:
        target.sourceReceiptNo,
      stockCode:
        target.stockCode,
      corpCode:
        target.corpCode,
      actionType:
        target.actionType,
      priorReason:
        target.parserDisposition,
      chainMemberReceiptNos:
        chain?.memberReceiptNos ?? [],
      availableDocumentCount:
        availableDocs.length,
      alternateAvailableCount:
        alternateAvailable.length,
      sourceDocumentAvailable:
        availableDocs.some(
          (row) =>
            row.receiptNo ===
            target.sourceReceiptNo,
        ),
      fallbackCandidateReceiptNos:
        alternateAvailable.map(
          (row) => row.receiptNo,
        ),
      documents,
    });

    console.log(
      [
        'PROBE',
        `${i + 1}/${targets.length}`,
        `root=${target.providerEventId}`,
        `source=${target.sourceReceiptNo}`,
        `prior=${target.parserDisposition}`,
        `docs=${availableDocs.length}`,
        `fallbacks=${alternateAvailable.length}`,
      ].join(' '),
    );
  }

  const report = {
    version: VERSION,
    status:
      rows.length === 5
        ? 'REMAINING_REVERSE_SPLIT_PROBE_COMPLETE'
        : 'REMAINING_REVERSE_SPLIT_PROBE_COUNT_MISMATCH',

    counts: {
      targetRows: rows.length,
      sourceDocumentAvailable:
        rows.filter((row) => row.sourceDocumentAvailable).length,
      sourceDocumentUnavailable:
        rows.filter((row) => !row.sourceDocumentAvailable).length,
      rowsWithAlternateChainDocuments:
        rows.filter((row) => row.alternateAvailableCount > 0).length,
      rowsWithHeadingCandidates:
        rows.filter((row) =>
          row.documents.some(
            (doc) =>
              Array.isArray(doc.headingCandidates) &&
              doc.headingCandidates.length > 0,
          ),
        ).length,
    },

    safety: {
      networkRequests: 0,
      databaseWrites: 0,
      productionApplied: false,
      canonicalEventsCreated: 0,
      providerEventIdsPersisted: 0,
      finalEffectiveDatesAssigned: 0,
      marketFactorsComputed: 0,
      coverageWindowAdvanced: false,
    },

    rows,

    outputFile: path
      .relative(root, outputFile)
      .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version: VERSION,
        rows: rows.map((row) => [
          row.providerEventId,
          row.sourceReceiptNo,
          row.priorReason,
          row.fallbackCandidateReceiptNos,
        ]),
      }),
    );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: VERSION,
        ...report.counts,
        networkRequests: 0,
        databaseWrites: 0,
        productionApplied: false,
        canonicalEventsCreated: 0,
        finalEffectiveDatesAssigned: 0,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    report.status ===
    'REMAINING_REVERSE_SPLIT_PROBE_COUNT_MISMATCH'
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
