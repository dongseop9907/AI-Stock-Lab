import {
  createHash,
} from "crypto";

import {
  inflateRawSync,
} from "zlib";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

type KrxMarket =
  | "KOSPI"
  | "KOSDAQ";

type SecurityType =
  | "COMMON"
  | "PREFERRED"
  | "ETF"
  | "ETN"
  | "REIT"
  | "SPAC"
  | "FUND"
  | "UNKNOWN"
  | "OTHER";

interface ParsedMasterMember {
  stockCode:
    string;

  standardCode:
    string | null;

  stockName:
    string;

  market:
    KrxMarket;

  sector:
    string | null;

  securityType:
    SecurityType;

  listingDate:
    string | null;

  listed:
    boolean;

  tradable:
    boolean;

  flags:
    Record<
      string,
      unknown
    >;

  sourcePayload:
    Record<
      string,
      unknown
    >;
}

interface DownloadedMaster {
  market:
    KrxMarket;

  url:
    string;

  filename:
    string;

  observedAt:
    string;

  etag:
    string | null;

  lastModified:
    string | null;

  rawLineCount:
    number;

  members:
    ParsedMasterMember[];
}

interface ExistingSecurityRow {
  stock_code:
    string;

  first_seen_date:
    string | null;

  listing_date:
    string | null;
}

interface OpenMembershipRow {
  id:
    string;

  stock_code:
    string;

  stock_name:
    string;

  market:
    string | null;

  sector:
    string | null;

  security_type:
    string;

  valid_from:
    string;

  listed:
    boolean;

  tradable:
    boolean;
}

const KOSPI_URL =
  "https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip";

const KOSDAQ_URL =
  "https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip";

/*
 * The field widths are taken from KIS's official public examples.
 *
 * The official Python examples slice 228/222 characters from each
 * text-mode row, which includes the line ending (and, for KOSPI,
 * an extra padding character before the parsed fixed-width fields).
 *
 * We split line endings before parsing, so the reliable field-tail
 * length is the SUM of the published field widths:
 * KOSPI = 226 parsed characters
 * KOSDAQ = 221 parsed characters.
 */
const KOSPI_WIDTHS = [
  2, 1, 4, 4, 4,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 1,
  1, 9, 5, 5, 1,
  1, 1, 2, 1, 1,
  1, 2, 2, 2, 3,
  1, 3, 12, 12, 8,
  15, 21, 2, 7, 1,
  1, 1, 1, 1, 9,
  9, 9, 5, 9, 8,
  9, 3, 1, 1, 1,
] as const;

const KOSDAQ_WIDTHS = [
  2, 1,
  4, 4, 4, 1, 1,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 9,
  5, 5, 1, 1, 1,
  2, 1, 1, 1, 2,
  2, 2, 3, 1, 3,
  12, 12, 8, 15, 21,
  2, 7, 1, 1, 1,
  1, 9, 9, 9, 5,
  9, 8, 9, 3, 1,
  1, 1,
] as const;

function getKoreanDate(
  now =
    new Date(),
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    )
      .formatToParts(
        now,
      );

  const map =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return `${map.year}-${map.month}-${map.day}`;
}

function normalizeSqlDate(
  value:
    string | undefined,
) {
  const result =
    value ??
    getKoreanDate();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      result,
    )
  ) {
    throw new Error(
      "INVALID_UNIVERSE_AS_OF_DATE",
    );
  }

  return result;
}

function compactDateToSql(
  value:
    string,
) {
  const trimmed =
    value.trim();

  if (
    !/^\d{8}$/.test(
      trimmed,
    ) ||
    trimmed ===
      "00000000"
  ) {
    return null;
  }

  const result =
    `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;

  const parsed =
    new Date(
      `${result}T00:00:00.000Z`,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return null;
  }

  return result;
}

function parseFixedWidth(
  tail:
    string,

  widths:
    readonly number[],
) {
  const result:
    string[] = [];

  let offset =
    0;

  for (
    const width
    of widths
  ) {
    result.push(
      tail
        .slice(
          offset,
          offset +
            width,
        )
        .trim(),
    );

    offset +=
      width;
  }

  return result;
}

function isTruthyFlag(
  value:
    string | undefined,
) {
  const normalized =
    (
      value ??
      ""
    )
      .trim()
      .toUpperCase();

  return (
    normalized ===
      "Y" ||
    normalized ===
      "1" ||
    normalized ===
      "T"
  );
}

function normalizeStockCode(
  value:
    string,
) {
  const trimmed =
    value.trim();

  const match =
    trimmed.match(
      /(\d{6})$/,
    );

  return match?.[1] ??
    null;
}

function classifySecurityType(
  groupCode:
    string,

  preferredCode:
    string,

  spacFlag:
    string,

  etpCode:
    string,
): SecurityType {
  const group =
    groupCode
      .trim()
      .toUpperCase();

  const preferred =
    preferredCode
      .trim()
      .toUpperCase();

  if (
    group ===
      "EF" ||
    group ===
      "FE"
  ) {
    return "ETF";
  }

  if (
    group ===
      "RT"
  ) {
    return "REIT";
  }

  if (
    group ===
      "MF" ||
    group ===
      "BC"
  ) {
    return "FUND";
  }

  if (
    isTruthyFlag(
      spacFlag,
    )
  ) {
    return "SPAC";
  }

  if (
    group ===
      "ST"
  ) {
    if (
      preferred &&
      preferred !==
        "0" &&
      preferred !==
        "N"
    ) {
      return "PREFERRED";
    }

    return "COMMON";
  }

  if (
    etpCode.trim()
  ) {
    return "ETN";
  }

  if (
    group
  ) {
    return "OTHER";
  }

  return "UNKNOWN";
}

function includeInStockUniverse(
  groupCode:
    string,

  securityType:
    SecurityType,
) {
  const group =
    groupCode
      .trim()
      .toUpperCase();

  if (
    [
      "EW",
      "EF",
      "FE",
      "SW",
      "SR",
      "BC",
    ].includes(
      group,
    )
  ) {
    return false;
  }

  if (
    securityType ===
      "ETF" ||
    securityType ===
      "ETN"
  ) {
    return false;
  }

  return true;
}

function parseMasterLine(
  market:
    KrxMarket,

  line:
    string,
): ParsedMasterMember | null {
  const widths =
    market ===
      "KOSPI"
      ? KOSPI_WIDTHS
      : KOSDAQ_WIDTHS;

  const tailLength =
    widths.reduce(
      (
        total,
        width,
      ) =>
        total +
        width,
      0,
    );

  if (
    line.length <=
      tailLength +
        21
  ) {
    return null;
  }

  const prefix =
    line.slice(
      0,
      line.length -
        tailLength,
    );

  const tail =
    line.slice(
      -tailLength,
    );

  const stockCode =
    normalizeStockCode(
      prefix.slice(
        0,
        9,
      ),
    );

  const standardCode =
    prefix
      .slice(
        9,
        21,
      )
      .trim() ||
    null;

  const stockName =
    prefix
      .slice(21)
      .trim();

  if (
    !stockCode ||
    !stockName
  ) {
    return null;
  }

  const fields =
    parseFixedWidth(
      tail,
      widths,
    );

  const groupCode =
    fields[0] ??
    "";

  const sector =
    fields[2] ||
    null;

  const lowLiquidity =
    fields[6] ??
    "";

  const etpCode =
    market ===
      "KOSPI"
      ? (
          fields[12] ??
          ""
        )
      : (
          fields[8] ??
          ""
        );

  const spacFlag =
    market ===
      "KOSPI"
      ? (
          fields[19] ??
          ""
        )
      : (
          fields[14] ??
          ""
        );

  const halted =
    isTruthyFlag(
      market ===
        "KOSPI"
        ? fields[34]
        : fields[29],
    );

  const liquidation =
    isTruthyFlag(
      market ===
        "KOSPI"
        ? fields[35]
        : fields[30],
    );

  const management =
    isTruthyFlag(
      market ===
        "KOSPI"
        ? fields[36]
        : fields[31],
    );

  const listingDate =
    compactDateToSql(
      market ===
        "KOSPI"
        ? (
            fields[49] ??
            ""
          )
        : (
            fields[44] ??
            ""
          ),
    );

  const preferredCode =
    market ===
      "KOSPI"
      ? (
          fields[54] ??
          ""
        )
      : (
          fields[49] ??
          ""
        );

  const securityType =
    classifySecurityType(
      groupCode,
      preferredCode,
      spacFlag,
      etpCode,
    );

  if (
    !includeInStockUniverse(
      groupCode,
      securityType,
    )
  ) {
    return null;
  }

  return {
    stockCode,

    standardCode,

    stockName,

    market,

    sector,

    securityType,

    listingDate,

    listed:
      true,

    tradable:
      !halted &&
      !liquidation,

    flags: {
      groupCode,
      lowLiquidity:
        isTruthyFlag(
          lowLiquidity,
        ),

      halted,
      liquidation,
      management,

      spac:
        isTruthyFlag(
          spacFlag,
        ),

      preferredCode:
        preferredCode ||
        null,

      etpCode:
        etpCode ||
        null,
    },

    sourcePayload: {
      standardCode,
      groupCode,
      listingDate,
      preferredCode:
        preferredCode ||
        null,

      halted,
      liquidation,
      management,
    },
  };
}

function findEndOfCentralDirectory(
  buffer:
    Buffer,
) {
  const signature =
    0x06054b50;

  const minimum =
    Math.max(
      0,
      buffer.length -
        65557,
    );

  for (
    let offset =
      buffer.length -
      22;
    offset >=
      minimum;
    offset -=
      1
  ) {
    if (
      buffer.readUInt32LE(
        offset,
      ) ===
      signature
    ) {
      return offset;
    }
  }

  return -1;
}

function extractZipEntry(
  zip:
    Buffer,

  expectedFilename:
    string,
) {
  const eocd =
    findEndOfCentralDirectory(
      zip,
    );

  if (
    eocd <
      0
  ) {
    throw new Error(
      "KIS_MASTER_ZIP_EOCD_NOT_FOUND",
    );
  }

  const totalEntries =
    zip.readUInt16LE(
      eocd +
        10,
    );

  const centralOffset =
    zip.readUInt32LE(
      eocd +
        16,
    );

  let cursor =
    centralOffset;

  for (
    let index =
      0;
    index <
      totalEntries;
    index +=
      1
  ) {
    if (
      zip.readUInt32LE(
        cursor,
      ) !==
      0x02014b50
    ) {
      throw new Error(
        "KIS_MASTER_ZIP_CENTRAL_DIRECTORY_INVALID",
      );
    }

    const compressionMethod =
      zip.readUInt16LE(
        cursor +
          10,
      );

    const compressedSize =
      zip.readUInt32LE(
        cursor +
          20,
      );

    const filenameLength =
      zip.readUInt16LE(
        cursor +
          28,
      );

    const extraLength =
      zip.readUInt16LE(
        cursor +
          30,
      );

    const commentLength =
      zip.readUInt16LE(
        cursor +
          32,
      );

    const localHeaderOffset =
      zip.readUInt32LE(
        cursor +
          42,
      );

    const filename =
      zip
        .subarray(
          cursor +
            46,
          cursor +
            46 +
            filenameLength,
        )
        .toString(
          "utf8",
        );

    if (
      filename ===
        expectedFilename ||
      (
        !expectedFilename &&
        filename
          .toLowerCase()
          .endsWith(
            ".mst",
          )
      )
    ) {
      if (
        zip.readUInt32LE(
          localHeaderOffset,
        ) !==
        0x04034b50
      ) {
        throw new Error(
          "KIS_MASTER_ZIP_LOCAL_HEADER_INVALID",
        );
      }

      const localFilenameLength =
        zip.readUInt16LE(
          localHeaderOffset +
            26,
        );

      const localExtraLength =
        zip.readUInt16LE(
          localHeaderOffset +
            28,
        );

      const dataStart =
        localHeaderOffset +
        30 +
        localFilenameLength +
        localExtraLength;

      const compressed =
        zip.subarray(
          dataStart,
          dataStart +
            compressedSize,
        );

      if (
        compressionMethod ===
          0
      ) {
        return Buffer.from(
          compressed,
        );
      }

      if (
        compressionMethod ===
          8
      ) {
        return inflateRawSync(
          compressed,
        );
      }

      throw new Error(
        `UNSUPPORTED_KIS_MASTER_ZIP_METHOD: ${compressionMethod}`,
      );
    }

    cursor +=
      46 +
      filenameLength +
      extraLength +
      commentLength;
  }

  throw new Error(
    `KIS_MASTER_FILE_NOT_FOUND_IN_ZIP: ${expectedFilename}`,
  );
}

async function downloadMaster(
  market:
    KrxMarket,
): Promise<
  DownloadedMaster
> {
  const url =
    market ===
      "KOSPI"
      ? KOSPI_URL
      : KOSDAQ_URL;

  const filename =
    market ===
      "KOSPI"
      ? "kospi_code.mst"
      : "kosdaq_code.mst";

  const response =
    await fetch(
      url,
      {
        cache:
          "no-store",
      },
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `KIS_MASTER_DOWNLOAD_FAILED ${market}: HTTP ${response.status}`,
    );
  }

  const zip =
    Buffer.from(
      await response
        .arrayBuffer(),
    );

  const mst =
    extractZipEntry(
      zip,
      filename,
    );

  /*
   * Node's WHATWG TextDecoder supports the WHATWG alias euc-kr,
   * which covers the CP949-compatible Korean master-file text used here.
   */
  const decoded =
    new TextDecoder(
      "euc-kr",
    )
      .decode(
        mst,
      );

  const lines =
    decoded
      .split(
        /\r?\n/,
      )
      .map(
        (
          line,
        ) =>
          line.replace(
            /\r$/,
            "",
          ),
      )
      .filter(
        (
          line,
        ) =>
          line.trim()
            .length >
          0,
      );

  const members =
    lines
      .map(
        (
          line,
        ) =>
          parseMasterLine(
            market,
            line,
          ),
      )
      .filter(
        (
          member,
        ): member is ParsedMasterMember =>
          member !==
          null,
      );

  return {
    market,
    url,
    filename,

    observedAt:
      new Date()
        .toISOString(),

    etag:
      response
        .headers
        .get(
          "etag",
        ),

    lastModified:
      response
        .headers
        .get(
          "last-modified",
        ),

    rawLineCount:
      lines.length,

    members,
  };
}

function ensurePlausibleCoverage(
  master:
    DownloadedMaster,
) {
  const minimum =
    master.market ===
      "KOSPI"
      ? 500
      : 1000;

  if (
    master.members.length <
      minimum
  ) {
    throw new Error(
      `${master.market}_MASTER_COVERAGE_TOO_SMALL: ${master.members.length} < ${minimum}`,
    );
  }

  const codes =
    new Set(
      master.members.map(
        (
          member,
        ) =>
          member.stockCode,
      ),
    );

  if (
    codes.size !==
      master.members.length
  ) {
    throw new Error(
      `${master.market}_MASTER_DUPLICATE_STOCK_CODES`,
    );
  }
}

function chunkArray<T>(
  values:
    T[],

  size =
    500,
) {
  const chunks:
    T[][] = [];

  for (
    let index =
      0;
    index <
      values.length;
    index +=
      size
  ) {
    chunks.push(
      values.slice(
        index,
        index +
          size,
      ),
    );
  }

  return chunks;
}

async function loadAllOpenMemberships(
  universeCode:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const result:
    OpenMembershipRow[] = [];

  const pageSize =
    1000;

  for (
    let from =
      0;
    ;
    from +=
      pageSize
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "stock_universe_memberships",
        )
        .select(`
          id,
          stock_code,
          stock_name,
          market,
          sector,
          security_type,
          valid_from,
          listed,
          tradable
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .is(
          "valid_to",
          null,
        )
        .order(
          "stock_code",
          {
            ascending:
              true,
          },
        )
        .range(
          from,
          from +
            pageSize -
            1,
        );

    if (
      error
    ) {
      throw new Error(
        `v8.1 membership load failed (${universeCode}): ${error.message}`,
      );
    }

    const rows =
      (
        data ??
        []
      ) as OpenMembershipRow[];

    result.push(
      ...rows,
    );

    if (
      rows.length <
        pageSize
    ) {
      break;
    }
  }

  return result;
}

async function loadExistingSecurityMap(
  stockCodes:
    string[],
) {
  const supabase =
    createSupabaseServerClient();

  const result =
    new Map<
      string,
      ExistingSecurityRow
    >();

  for (
    const codes
    of chunkArray(
      stockCodes,
      500,
    )
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "stock_universe_securities",
        )
        .select(
          "stock_code,first_seen_date,listing_date",
        )
        .in(
          "stock_code",
          codes,
        );

    if (
      error
    ) {
      throw new Error(
        `v8.1 existing security load failed: ${error.message}`,
      );
    }

    for (
      const row
      of (
        data ??
        []
      ) as ExistingSecurityRow[]
    ) {
      result.set(
        row.stock_code,
        row,
      );
    }
  }

  return result;
}

async function upsertSecurityMaster(
  members:
    ParsedMasterMember[],

  asOfDate:
    string,

  sourceVersion:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const uniqueByCode =
    new Map<
      string,
      ParsedMasterMember
    >();

  for (
    const member
    of members
  ) {
    uniqueByCode.set(
      member.stockCode,
      member,
    );
  }

  const uniqueMembers =
    [
      ...uniqueByCode
        .values(),
    ];

  const existing =
    await loadExistingSecurityMap(
      uniqueMembers.map(
        (
          member,
        ) =>
          member.stockCode,
      ),
    );

  const now =
    new Date()
      .toISOString();

  const rows =
    uniqueMembers.map(
      (
        member,
      ) => {
        const old =
          existing.get(
            member.stockCode,
          );

        const firstSeen =
          old
            ?.first_seen_date ??
          asOfDate;

        return {
          stock_code:
            member.stockCode,

          stock_name:
            member.stockName,

          market:
            member.market,

          sector:
            member.sector,

          security_type:
            member.securityType,

          listing_date:
            member.listingDate ??
            old
              ?.listing_date ??
            null,

          /*
           * A master file tells us what we observe now.
           * first_seen_date is therefore observation-based,
           * not backdated to listing_date.
           */
          first_seen_date:
            firstSeen,

          last_seen_date:
            asOfDate,

          source:
            "KIS_PUBLIC_MASTER",

          source_version:
            sourceVersion,

          metadata: {
            standardCode:
              member.standardCode,

            flags:
              member.flags,
          },

          updated_at:
            now,
        };
      },
    );

  for (
    const chunk
    of chunkArray(
      rows,
      500,
    )
  ) {
    const {
      error,
    } =
      await supabase
        .from(
          "stock_universe_securities",
        )
        .upsert(
          chunk,
          {
            onConflict:
              "stock_code",
          },
        );

    if (
      error
    ) {
      throw new Error(
        `v8.1 security master upsert failed: ${error.message}`,
      );
    }
  }

  return {
    upserted:
      rows.length,
  };
}

function buildFingerprint(
  universeCode:
    string,

  asOfDate:
    string,

  members:
    ParsedMasterMember[],

  sourceVersion:
    string,
) {
  const canonical =
    members
      .map(
        (
          member,
        ) => ({
          stockCode:
            member.stockCode,

          stockName:
            member.stockName,

          market:
            member.market,

          securityType:
            member.securityType,

          listed:
            member.listed,

          tradable:
            member.tradable,

          listingDate:
            member.listingDate,

          groupCode:
            member
              .flags
              .groupCode,
        }),
      )
      .sort(
        (
          left,
          right,
        ) =>
          left
            .stockCode
            .localeCompare(
              right.stockCode,
            ),
      );

  return createHash(
    "sha256",
  )
    .update(
      JSON.stringify({
        universeCode,
        asOfDate,
        sourceVersion,
        members:
          canonical,
      }),
    )
    .digest(
      "hex",
    );
}

function sameMembershipState(
  existing:
    OpenMembershipRow,

  member:
    ParsedMasterMember,
) {
  return (
    existing.stock_name ===
      member.stockName &&
    (
      existing.market ??
      null
    ) ===
      member.market &&
    (
      existing.sector ??
      null
    ) ===
      (
        member.sector ??
        null
      ) &&
    existing.security_type ===
      member.securityType &&
    existing.listed ===
      member.listed &&
    existing.tradable ===
      member.tradable
  );
}

async function applyUniverseSnapshot(
  input: {
    universeCode:
      string;

    asOfDate:
      string;

    members:
      ParsedMasterMember[];

    sourceVersion:
      string;

    sourceMetadata:
      Record<
        string,
        unknown
      >;
  },
) {
  const supabase =
    createSupabaseServerClient();

  const evidenceFingerprint =
    buildFingerprint(
      input.universeCode,
      input.asOfDate,
      input.members,
      input.sourceVersion,
    );

  const {
    data: existingSnapshot,
    error: existingSnapshotError,
  } =
    await supabase
      .from(
        "stock_universe_snapshots",
      )
      .select(
        "id",
      )
      .eq(
        "evidence_fingerprint",
        evidenceFingerprint,
      )
      .maybeSingle();

  if (
    existingSnapshotError
  ) {
    throw new Error(
      `v8.1 snapshot duplicate check failed (${input.universeCode}): ${existingSnapshotError.message}`,
    );
  }

  let snapshotId:
    string;

  let snapshotSaved:
    boolean;

  if (
    existingSnapshot
  ) {
    snapshotId =
      String(
        existingSnapshot.id,
      );

    snapshotSaved =
      false;
  } else {
    const {
      data: snapshot,
      error: snapshotError,
    } =
      await supabase
        .from(
          "stock_universe_snapshots",
        )
        .insert({
          universe_code:
            input.universeCode,

          as_of_date:
            input.asOfDate,

          source:
            "KIS_PUBLIC_MASTER",

          source_version:
            input.sourceVersion,

          coverage_status:
            "COMPLETE",

          member_count:
            input.members.length,

          evidence_fingerprint:
            evidenceFingerprint,

          metadata:
            input.sourceMetadata,

          production_applied:
            false,
        })
        .select(
          "id",
        )
        .single();

    if (
      snapshotError ||
      !snapshot
    ) {
      throw new Error(
        `v8.1 snapshot insert failed (${input.universeCode}): ${
          snapshotError?.message ??
          "NO_SNAPSHOT"
        }`,
      );
    }

    snapshotId =
      String(
        snapshot.id,
      );

    snapshotSaved =
      true;

    const snapshotMembers =
      input.members.map(
        (
          member,
        ) => ({
          snapshot_id:
            snapshotId,

          stock_code:
            member.stockCode,

          stock_name:
            member.stockName,

          market:
            member.market,

          sector:
            member.sector,

          security_type:
            member.securityType,

          listed:
            member.listed,

          tradable:
            member.tradable,

          flags:
            member.flags,

          source_payload:
            member.sourcePayload,
        }),
      );

    for (
      const chunk
      of chunkArray(
        snapshotMembers,
        500,
      )
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "stock_universe_snapshot_members",
          )
          .insert(
            chunk,
          );

      if (
        error
      ) {
        throw new Error(
          `v8.1 snapshot-member insert failed (${input.universeCode}): ${error.message}`,
        );
      }
    }
  }

  const openMemberships =
    await loadAllOpenMemberships(
      input.universeCode,
    );

  const memberByCode =
    new Map(
      input.members.map(
        (
          member,
        ) => [
          member.stockCode,
          member,
        ],
      ),
    );

  const openByCode =
    new Map(
      openMemberships.map(
        (
          row,
        ) => [
          row.stock_code,
          row,
        ],
      ),
    );

  const closeIds:
    string[] = [];

  const deleteSameDayIds:
    string[] = [];

  for (
    const existing
    of openMemberships
  ) {
    const current =
      memberByCode.get(
        existing.stock_code,
      );

    const mustEnd =
      !current ||
      !sameMembershipState(
        existing,
        current,
      );

    if (
      !mustEnd
    ) {
      continue;
    }

    if (
      existing.valid_from ===
        input.asOfDate
    ) {
      /*
       * Same-day re-collection is a revision of today's daily state.
       * Delete and replace rather than creating an empty interval.
       */
      deleteSameDayIds.push(
        existing.id,
      );
    } else if (
      existing.valid_from <
        input.asOfDate
    ) {
      closeIds.push(
        existing.id,
      );
    }
  }

  for (
    const ids
    of chunkArray(
      closeIds,
      500,
    )
  ) {
    const {
      error,
    } =
      await supabase
        .from(
          "stock_universe_memberships",
        )
        .update({
          valid_to:
            input.asOfDate,

          updated_at:
            new Date()
              .toISOString(),
        })
        .in(
          "id",
          ids,
        );

    if (
      error
    ) {
      throw new Error(
        `v8.1 membership close failed (${input.universeCode}): ${error.message}`,
      );
    }
  }

  for (
    const ids
    of chunkArray(
      deleteSameDayIds,
      500,
    )
  ) {
    const {
      error,
    } =
      await supabase
        .from(
          "stock_universe_memberships",
        )
        .delete()
        .in(
          "id",
          ids,
        );

    if (
      error
    ) {
      throw new Error(
        `v8.1 same-day membership revision failed (${input.universeCode}): ${error.message}`,
      );
    }
  }

  const endedCodes =
    new Set(
      openMemberships
        .filter(
          (
            row,
          ) =>
            closeIds.includes(
              row.id,
            ) ||
            deleteSameDayIds.includes(
              row.id,
            ),
        )
        .map(
          (
            row,
          ) =>
            row.stock_code,
        ),
    );

  const newMemberships =
    input.members
      .filter(
        (
          member,
        ) => {
          const old =
            openByCode.get(
              member.stockCode,
            );

          if (
            !old
          ) {
            return true;
          }

          return endedCodes.has(
            member.stockCode,
          );
        },
      )
      .map(
        (
          member,
        ) => ({
          universe_code:
            input.universeCode,

          stock_code:
            member.stockCode,

          stock_name:
            member.stockName,

          market:
            member.market,

          sector:
            member.sector,

          security_type:
            member.securityType,

          valid_from:
            input.asOfDate,

          valid_to:
            null,

          listed:
            member.listed,

          tradable:
            member.tradable,

          pit_eligible:
            true,

          evidence_type:
            "OBSERVED_SNAPSHOT",

          source:
            "KIS_PUBLIC_MASTER",

          source_version:
            input.sourceVersion,

          source_snapshot_id:
            snapshotId,

          coverage_status:
            "COMPLETE",

          metadata: {
            standardCode:
              member.standardCode,

            flags:
              member.flags,

            historicalMembershipBeforeValidFromKnown:
              false,
          },
        }),
      );

  for (
    const chunk
    of chunkArray(
      newMemberships,
      500,
    )
  ) {
    const {
      error,
    } =
      await supabase
        .from(
          "stock_universe_memberships",
        )
        .insert(
          chunk,
        );

    if (
      error
    ) {
      throw new Error(
        `v8.1 membership insert failed (${input.universeCode}): ${error.message}`,
      );
    }
  }

  const {
    error: definitionError,
  } =
    await supabase
      .from(
        "stock_universe_definitions",
      )
      .update({
        is_ready:
          true,

        metadata: {
          collectorReady:
            true,

          collectorVersion:
            "V8_1",

          source:
            "KIS_PUBLIC_MASTER",

          lastCompleteSnapshotId:
            snapshotId,

          lastCompleteAsOfDate:
            input.asOfDate,

          memberCount:
            input.members.length,
        },

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "universe_code",
        input.universeCode,
      );

  if (
    definitionError
  ) {
    throw new Error(
      `v8.1 universe definition update failed (${input.universeCode}): ${definitionError.message}`,
    );
  }

  return {
    universeCode:
      input.universeCode,

    snapshotId,

    snapshotSaved,

    coverageStatus:
      "COMPLETE" as const,

    memberCount:
      input.members.length,

    openedIntervals:
      newMemberships.length,

    closedIntervals:
      closeIds.length,

    sameDayRevisions:
      deleteSameDayIds.length,
  };
}

function buildSourceVersion(
  kospi:
    DownloadedMaster,

  kosdaq:
    DownloadedMaster,
) {
  const sourceDescriptor = {
    kospi: {
      etag:
        kospi.etag,

      lastModified:
        kospi.lastModified,
    },

    kosdaq: {
      etag:
        kosdaq.etag,

      lastModified:
        kosdaq.lastModified,
    },
  };

  const shortHash =
    createHash(
      "sha256",
    )
      .update(
        JSON.stringify(
          sourceDescriptor,
        ),
      )
      .digest(
        "hex",
      )
      .slice(
        0,
        16,
      );

  return `KIS_MASTER_V8_1_${shortHash}`;
}

export async function syncKrxPointInTimeUniverseV81(
  input: {
    asOfDate?:
      string;
  } = {},
) {
  const supabase =
    createSupabaseServerClient();

  const asOfDate =
    normalizeSqlDate(
      input.asOfDate,
    );

  const {
    data: run,
    error: runError,
  } =
    await supabase
      .from(
        "stock_universe_sync_runs",
      )
      .insert({
        as_of_date:
          asOfDate,

        status:
          "RUNNING",

        source:
          "KIS_PUBLIC_MASTER",

        production_applied:
          false,
      })
      .select(
        "id,started_at",
      )
      .single();

  if (
    runError ||
    !run
  ) {
    throw new Error(
      `v8.1 universe sync run create failed: ${
        runError?.message ??
        "NO_RUN"
      }`,
    );
  }

  const runId =
    String(
      run.id,
    );

  try {
    const [
      kospi,
      kosdaq,
    ] =
      await Promise.all([
        downloadMaster(
          "KOSPI",
        ),

        downloadMaster(
          "KOSDAQ",
        ),
      ]);

    ensurePlausibleCoverage(
      kospi,
    );

    ensurePlausibleCoverage(
      kosdaq,
    );

    const sourceVersion =
      buildSourceVersion(
        kospi,
        kosdaq,
      );

    const combinedMap =
      new Map<
        string,
        ParsedMasterMember
      >();

    for (
      const member
      of [
        ...kospi.members,
        ...kosdaq.members,
      ]
    ) {
      const existing =
        combinedMap.get(
          member.stockCode,
        );

      if (
        existing &&
        existing.market !==
          member.market
      ) {
        throw new Error(
          `CROSS_MARKET_DUPLICATE_STOCK_CODE: ${member.stockCode}`,
        );
      }

      combinedMap.set(
        member.stockCode,
        member,
      );
    }

    const combined =
      [
        ...combinedMap
          .values(),
      ];

    await upsertSecurityMaster(
      combined,
      asOfDate,
      sourceVersion,
    );

    const sourceMetadata = {
      collectorVersion:
        "V8_1",

      source:
        "KIS_PUBLIC_MASTER",

      historicalBackfill:
        false,

      observedCurrentMembershipOnly:
        true,

      fileHeaders: {
        kospi: {
          url:
            kospi.url,

          etag:
            kospi.etag,

          lastModified:
            kospi.lastModified,

          rawLineCount:
            kospi.rawLineCount,
        },

        kosdaq: {
          url:
            kosdaq.url,

          etag:
            kosdaq.etag,

          lastModified:
            kosdaq.lastModified,

          rawLineCount:
            kosdaq.rawLineCount,
        },
      },

      filterPolicy: {
        excludesClearlyNonStockEtpAndRights:
          true,

        excludedGroupCodes: [
          "EW",
          "EF",
          "FE",
          "SW",
          "SR",
          "BC",
        ],
      },
    };

    const kospiSnapshot =
      await applyUniverseSnapshot({
        universeCode:
          "KRX_KOSPI_LISTED",

        asOfDate,

        members:
          kospi.members,

        sourceVersion,

        sourceMetadata: {
          ...sourceMetadata,

          market:
            "KOSPI",
        },
      });

    const kosdaqSnapshot =
      await applyUniverseSnapshot({
        universeCode:
          "KRX_KOSDAQ_LISTED",

        asOfDate,

        members:
          kosdaq.members,

        sourceVersion,

        sourceMetadata: {
          ...sourceMetadata,

          market:
            "KOSDAQ",
        },
      });

    const allSnapshot =
      await applyUniverseSnapshot({
        universeCode:
          "KRX_ALL_LISTED",

        asOfDate,

        members:
          combined,

        sourceVersion,

        sourceMetadata: {
          ...sourceMetadata,

          markets: [
            "KOSPI",
            "KOSDAQ",
          ],
        },
      });

    const finishedAt =
      new Date()
        .toISOString();

    const result = {
      version:
        "POINT_IN_TIME_UNIVERSE_COLLECTOR_V8_1",

      runId,

      status:
        "SUCCESS" as const,

      asOfDate,

      source:
        "KIS_PUBLIC_MASTER",

      sourceVersion,

      counts: {
        kospiRaw:
          kospi.rawLineCount,

        kospiMembers:
          kospi.members.length,

        kosdaqRaw:
          kosdaq.rawLineCount,

        kosdaqMembers:
          kosdaq.members.length,

        combinedMembers:
          combined.length,
      },

      snapshots: {
        kospi:
          kospiSnapshot,

        kosdaq:
          kosdaqSnapshot,

        all:
          allSnapshot,
      },

      safety: {
        productionApplied:
          false,

        historicalMembershipFabricated:
          false,

        membershipBeginsAtObservedDate:
          true,

        incompleteSourceCanBeMarkedComplete:
          false,

        legacyStocksTableModified:
          false,
      },
    };

    const {
      error: updateError,
    } =
      await supabase
        .from(
          "stock_universe_sync_runs",
        )
        .update({
          finished_at:
            finishedAt,

          status:
            "SUCCESS",

          source_version:
            sourceVersion,

          kospi_raw_count:
            kospi.rawLineCount,

          kospi_member_count:
            kospi.members.length,

          kosdaq_raw_count:
            kosdaq.rawLineCount,

          kosdaq_member_count:
            kosdaq.members.length,

          combined_member_count:
            combined.length,

          snapshots:
            result.snapshots,

          result,

          production_applied:
            false,
        })
        .eq(
          "id",
          runId,
        );

    if (
      updateError
    ) {
      throw new Error(
        `v8.1 universe sync audit update failed: ${updateError.message}`,
      );
    }

    return result;
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_V8_1_UNIVERSE_SYNC_ERROR";

    await supabase
      .from(
        "stock_universe_sync_runs",
      )
      .update({
        finished_at:
          new Date()
            .toISOString(),

        status:
          "FAILED",

        error_message:
          message,

        production_applied:
          false,
      })
      .eq(
        "id",
        runId,
      );

    throw error;
  }
}
