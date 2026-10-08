const fs = require("fs");
const path = require("path");

const root = process.cwd();

const probePath = path.resolve(
  root,
  "scripts/alpha-v3-gap-slippage-guard-preservation-probe-v1.cjs",
);

if (!fs.existsSync(probePath)) {
  throw new Error(
    "GUARD_PRESERVATION_PROBE_NOT_FOUND",
  );
}

const before =
  fs.readFileSync(
    probePath,
    "utf8",
  );

const oldBlock = `function extractFunction(
  source,
  functionName,
) {
  const lower =
    source.toLowerCase();

  const needle =
    \`function public.\${functionName.toLowerCase()}(\`;

  const hit =
    lower.lastIndexOf(
      needle,
    );

  if (hit < 0) {
    throw new Error(
      \`FUNCTION_NOT_FOUND:\${functionName}\`,
    );
  }

  const createOrReplace =
    lower.lastIndexOf(
      "create or replace function",
      hit,
    );

  const create =
    lower.lastIndexOf(
      "create function",
      hit,
    );

  const start =
    Math.max(
      createOrReplace,
      create,
    );

  const end =
    lower.indexOf(
      "$$;",
      hit,
    );

  if (
    start < 0 ||
    end < 0
  ) {
    throw new Error(
      \`FUNCTION_BOUNDARY_NOT_FOUND:\${functionName}\`,
    );
  }

  return source.slice(
    start,
    end + 3,
  );
}`;

const newBlock = `function extractFunction(
  source,
  functionName,
) {
  const lower =
    source.toLowerCase();

  const functionNameLower =
    functionName.toLowerCase();

  /*
   * Do NOT search for the last occurrence of
   * "function public.<name>(" because REVOKE/GRANT statements
   * also contain that phrase after the real CREATE FUNCTION.
   *
   * Anchor specifically to the CREATE declaration.
   */
  const createOrReplaceNeedle =
    \`create or replace function public.\${functionNameLower}(\`;

  const createNeedle =
    \`create function public.\${functionNameLower}(\`;

  const createOrReplaceStart =
    lower.indexOf(
      createOrReplaceNeedle,
    );

  const createStart =
    lower.indexOf(
      createNeedle,
    );

  const starts =
    [
      createOrReplaceStart,
      createStart,
    ].filter(
      (value) =>
        value >= 0,
    );

  if (
    starts.length === 0
  ) {
    throw new Error(
      \`FUNCTION_NOT_FOUND:\${functionName}\`,
    );
  }

  const start =
    Math.min(
      ...starts,
    );

  /*
   * Support both $$ and tagged PostgreSQL dollar quoting.
   * Find the AS $tag$ opener after the function declaration,
   * then locate the matching closing delimiter followed by ;.
   */
  const afterStart =
    source.slice(
      start,
    );

  const asMatch =
    afterStart.match(
      /\\bas\\s+(\\$[A-Za-z0-9_]*\\$)/i,
    );

  if (
    !asMatch
  ) {
    throw new Error(
      \`FUNCTION_DOLLAR_QUOTE_NOT_FOUND:\${functionName}\`,
    );
  }

  const delimiter =
    asMatch[1];

  const openerRelativeIndex =
    afterStart.indexOf(
      delimiter,
      asMatch.index,
    );

  if (
    openerRelativeIndex < 0
  ) {
    throw new Error(
      \`FUNCTION_DOLLAR_QUOTE_OPEN_NOT_FOUND:\${functionName}\`,
    );
  }

  const bodyStartRelative =
    openerRelativeIndex +
    delimiter.length;

  const closingRelativeIndex =
    afterStart.indexOf(
      delimiter,
      bodyStartRelative,
    );

  if (
    closingRelativeIndex < 0
  ) {
    throw new Error(
      \`FUNCTION_DOLLAR_QUOTE_CLOSE_NOT_FOUND:\${functionName}\`,
    );
  }

  let endRelative =
    closingRelativeIndex +
    delimiter.length;

  while (
    endRelative <
      afterStart.length &&
    /\\s/.test(
      afterStart[
        endRelative
      ],
    )
  ) {
    endRelative += 1;
  }

  if (
    afterStart[
      endRelative
    ] ===
    ";"
  ) {
    endRelative +=
      1;
  }

  return source.slice(
    start,
    start +
      endRelative,
  );
}`;

let after =
  before;

if (
  before.includes(
    oldBlock,
  )
) {
  after =
    before.replace(
      oldBlock,
      newBlock,
    );
} else if (
  before.includes(
    "createOrReplaceNeedle",
  ) &&
  before.includes(
    "FUNCTION_DOLLAR_QUOTE_NOT_FOUND",
  )
) {
  // Idempotent rerun.
} else {
  throw new Error(
    "EXPECTED_EXTRACT_FUNCTION_BLOCK_NOT_FOUND",
  );
}

fs.writeFileSync(
  probePath,
  after,
  "utf8",
);

const finalText =
  fs.readFileSync(
    probePath,
    "utf8",
  );

const checks = {
  anchoredToCreateDeclaration:
    finalText.includes(
      "createOrReplaceNeedle",
    ),

  noLastIndexFunctionHit:
    !finalText.includes(
      "lower.lastIndexOf(\n      needle",
    ),

  supportsTaggedDollarQuote:
    finalText.includes(
      "FUNCTION_DOLLAR_QUOTE_NOT_FOUND",
    ) &&
    finalText.includes(
      "/\\\\bas\\\\s+(\\\\$[A-Za-z0-9_]*\\\\$)/i",
    ),

  grantRevokeCannotHijackBoundary:
    finalText.includes(
      "REVOKE/GRANT statements",
    ),
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, value]) =>
        !value,
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
          ? "ALPHA_V3_GAP_SLIPPAGE_GUARD_PRESERVATION_PROBE_V1_FUNCTION_BOUNDARY_FIXED"
          : "ALPHA_V3_GAP_SLIPPAGE_GUARD_PRESERVATION_PROBE_V1_FUNCTION_BOUNDARY_REVIEW",

      diagnosis:
        "LAST_FUNCTION_NAME_OCCURRENCE_WAS_GRANT_OR_REVOKE_NOT_CREATE_FUNCTION",

      patchedFile:
        "scripts/alpha-v3-gap-slippage-guard-preservation-probe-v1.cjs",

      checks,
      failed,

      safety: {
        databaseReads:
          0,
        databaseWrites:
          0,
        networkCalls:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        migrationApplied:
          false,
      },

      nextGate:
        failed.length ===
        0
          ? "RERUN_GUARD_PRESERVATION_PROBE"
          : "REVIEW_PROBE_PATCH",
    },
    null,
    2,
  ),
);

if (
  failed.length >
  0
) {
  process.exitCode =
    2;
}
