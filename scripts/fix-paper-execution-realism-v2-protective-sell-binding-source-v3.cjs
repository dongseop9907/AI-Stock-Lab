const fs = require("fs");
const path = require("path");

const root = process.cwd();

const trailingRel =
  "lib/trading/update-trailing-stops.ts";

const backupRel =
  "lib/trading/update-trailing-stops.ts.pre-paper-execution-realism-v2-protective-sell";

const staticRel =
  "scripts/paper-execution-realism-v2-protective-sell-static-verify.cjs";

function abs(rel) {
  return path.resolve(root, rel);
}

function readRequired(rel) {
  const target = abs(rel);

  if (!fs.existsSync(target)) {
    throw new Error(
      `REQUIRED_FILE_MISSING:${rel}`,
    );
  }

  return fs.readFileSync(
    target,
    "utf8",
  );
}

function addImport(source) {
  if (
    source.includes(
      "resolveProtectiveSellExecutionRealismV2",
    )
  ) {
    return source;
  }

  return (
    `import {
  resolveProtectiveSellExecutionRealismV2,
} from "@/lib/trading/resolve-protective-sell-execution-realism-v2";

` +
    source
  );
}

function ensurePositionQuantity(source) {
  let src = source;

  const interfaceRe =
    /(interface\s+PositionRecord\s*\{[\s\S]*?\bstock_code\s*:\s*string\s*;)([\s\S]*?\})/m;

  const interfaceMatch =
    interfaceRe.exec(src);

  if (!interfaceMatch) {
    throw new Error(
      "TRAILING_POSITION_INTERFACE_NOT_FOUND",
    );
  }

  if (
    !/\bquantity\s*:\s*number\s*;/.test(
      interfaceMatch[0],
    )
  ) {
    const replacement =
      `${interfaceMatch[1]}
  quantity: number;${interfaceMatch[2]}`;

    src =
      src.slice(
        0,
        interfaceMatch.index,
      ) +
      replacement +
      src.slice(
        interfaceMatch.index +
          interfaceMatch[0].length,
      );
  }

  const positionQueryIndex =
    src.indexOf(
      '.from("paper_positions")',
    );

  if (positionQueryIndex < 0) {
    throw new Error(
      "TRAILING_POSITION_QUERY_NOT_FOUND",
    );
  }

  const selectStart =
    src.indexOf(
      ".select(`",
      positionQueryIndex,
    );

  const selectEnd =
    src.indexOf(
      "`)",
      selectStart,
    );

  if (
    selectStart < 0 ||
    selectEnd < 0
  ) {
    throw new Error(
      "TRAILING_POSITION_SELECT_BLOCK_NOT_FOUND",
    );
  }

  let selectBlock =
    src.slice(
      selectStart,
      selectEnd + 2,
    );

  if (
    !/\bquantity\b/.test(
      selectBlock,
    )
  ) {
    if (
      !/\bstock_code\b/.test(
        selectBlock,
      )
    ) {
      throw new Error(
        "TRAILING_POSITION_STOCK_CODE_SELECT_NOT_FOUND",
      );
    }

    selectBlock =
      selectBlock.replace(
        /(\bstock_code\b)(\s*)/,
        `$1,$2        quantity
`,
      );
  }

  return (
    src.slice(
      0,
      selectStart,
    ) +
    selectBlock +
    src.slice(
      selectEnd + 2,
    )
  );
}

function findStatementStart(
  source,
  rpcCallIndex,
) {
  const awaitIndex =
    source.lastIndexOf(
      "await",
      rpcCallIndex,
    );

  if (awaitIndex < 0) {
    throw new Error(
      "TRAILING_STOP_RPC_AWAIT_NOT_FOUND",
    );
  }

  /*
   * Walk backwards across continuation lines until we reach the
   * declaration/assignment line that owns the await expression.
   */
  let lineStart =
    source.lastIndexOf(
      "\n",
      awaitIndex,
    ) + 1;

  for (
    let i = 0;
    i < 8;
    i += 1
  ) {
    const currentLine =
      source
        .slice(
          lineStart,
          source.indexOf(
            "\n",
            lineStart,
          ) < 0
            ? source.length
            : source.indexOf(
                "\n",
                lineStart,
              ),
        );

    if (
      /\bconst\b|\blet\b|\bvar\b/.test(
        currentLine,
      )
    ) {
      return lineStart;
    }

    if (lineStart <= 0) {
      break;
    }

    const previousNewline =
      source.lastIndexOf(
        "\n",
        Math.max(
          0,
          lineStart - 2,
        ),
      );

    lineStart =
      previousNewline + 1;
  }

  throw new Error(
    "TRAILING_STOP_RPC_ASSIGNMENT_START_NOT_FOUND",
  );
}

function patchRpc(source) {
  let src =
    addImport(
      ensurePositionQuantity(
        source,
      ),
    );

  const rpcName =
    '"execute_paper_stop_loss"';

  const rpcNameIndex =
    src.indexOf(
      rpcName,
    );

  if (rpcNameIndex < 0) {
    throw new Error(
      "TRAILING_STOP_RPC_NAME_NOT_FOUND",
    );
  }

  const rpcCallIndex =
    src.lastIndexOf(
      "supabase.rpc(",
      rpcNameIndex,
    );

  if (rpcCallIndex < 0) {
    throw new Error(
      "TRAILING_STOP_RPC_CALL_NOT_FOUND",
    );
  }

  const statementStart =
    findStatementStart(
      src,
      rpcCallIndex,
    );

  const injection =
    `    const protectiveExecution =
      await resolveProtectiveSellExecutionRealismV2({
        supabase,
        stockCode:
          position.stock_code,
        requestedQuantity:
          position.quantity,
        referencePrice:
          currentPrice,
        observedAt:
          snapshot.observed_at,
      });

`;

  src =
    src.slice(
      0,
      statementStart,
    ) +
    injection +
    src.slice(
      statementStart,
    );

  const patchedRpcNameIndex =
    src.indexOf(
      rpcName,
      statementStart +
        injection.length,
    );

  if (patchedRpcNameIndex < 0) {
    throw new Error(
      "TRAILING_STOP_RPC_LOST_AFTER_INJECTION",
    );
  }

  const statementStartAfter =
    findStatementStart(
      src,
      src.lastIndexOf(
        "supabase.rpc(",
        patchedRpcNameIndex,
      ),
    );

  const statementEnd =
    src.indexOf(
      ";",
      patchedRpcNameIndex,
    );

  if (statementEnd < 0) {
    throw new Error(
      "TRAILING_STOP_RPC_STATEMENT_END_NOT_FOUND",
    );
  }

  let statement =
    src.slice(
      statementStartAfter,
      statementEnd + 1,
    );

  statement =
    statement.replace(
      rpcName,
      '"execute_paper_protective_sell_v2"',
    );

  if (
    !/p_exit_price\s*:\s*currentPrice/.test(
      statement,
    )
  ) {
    throw new Error(
      "TRAILING_EXIT_PRICE_ARGUMENT_NOT_FOUND",
    );
  }

  statement =
    statement.replace(
      /p_exit_price\s*:\s*currentPrice/,
      "p_exit_price: protectiveExecution.executionPrice",
    );

  const observedRe =
    /(p_observed_at\s*:\s*snapshot\.observed_at\s*,?)/;

  if (
    !observedRe.test(
      statement,
    )
  ) {
    throw new Error(
      "TRAILING_OBSERVED_AT_ARGUMENT_NOT_FOUND",
    );
  }

  statement =
    statement.replace(
      observedRe,
      `$1
        p_fill_quantity:
          protectiveExecution.filledQuantity,
        p_broker_fee:
          protectiveExecution.brokerFee,
        p_sell_tax:
          protectiveExecution.sellTax,
        p_execution_source:
          protectiveExecution.priceSource ??
          "PAPER_EXECUTION_REALISM_V2",
        p_exit_reason:
          "TRAILING_STOP",`,
    );

  src =
    src.slice(
      0,
      statementStartAfter,
    ) +
    statement +
    src.slice(
      statementEnd + 1,
    );

  return src;
}

function patchStaticVerifier(source) {
  let src = source;

  if (
    src.includes(
      "trailingSyntaxGuard",
    )
  ) {
    return src;
  }

  const anchor =
    `  noRealTradingEnable:
    !/real_order_enabled\\s*=\\s*true/i.test(
      stop +
      "\\n" +
      trailing +
      "\\n" +
      migration,
    ),`;

  if (!src.includes(anchor)) {
    throw new Error(
      "STATIC_VERIFIER_ANCHOR_NOT_FOUND",
    );
  }

  const replacement =
    `${anchor}

  trailingSyntaxGuard:
    !/=\\s*\\n\\s*const\\s+protectiveExecution\\b/.test(
      trailing,
    ) &&
    trailing.includes(
      "const protectiveExecution",
    ) &&
    trailing.includes(
      "execute_paper_protective_sell_v2",
    ),`;

  return src.replace(
    anchor,
    replacement,
  );
}

const backup =
  readRequired(
    backupRel,
  );

if (
  !backup.includes(
    '"execute_paper_stop_loss"',
  )
) {
  throw new Error(
    "TRAILING_BACKUP_DOES_NOT_CONTAIN_LEGACY_STOP_RPC",
  );
}

const patched =
  patchRpc(
    backup,
  );

if (
  /=\s*\n\s*const\s+protectiveExecution\b/.test(
    patched,
  )
) {
  throw new Error(
    "TRAILING_MALFORMED_ASSIGNMENT_STILL_PRESENT",
  );
}

if (
  !patched.includes(
    '"execute_paper_protective_sell_v2"',
  ) ||
  !patched.includes(
    "p_fill_quantity:",
  ) ||
  !patched.includes(
    "p_broker_fee:",
  ) ||
  !patched.includes(
    "p_sell_tax:",
  )
) {
  throw new Error(
    "TRAILING_V2_BINDING_INCOMPLETE",
  );
}

fs.writeFileSync(
  abs(trailingRel),
  patched,
  "utf8",
);

const staticSource =
  readRequired(
    staticRel,
  );

fs.writeFileSync(
  abs(staticRel),
  patchStaticVerifier(
    staticSource,
  ),
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_BINDING_SOURCE_V3_FIXED",
      fixedFile:
        trailingRel,
      restoredFrom:
        backupRel,
      fix:
        "INSERT_PROTECTIVE_EXECUTION_BEFORE_FULL_RPC_ASSIGNMENT_STATEMENT",
      staticVerifierHardened:
        true,
      databaseApplied:
        false,
      safety: {
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingChanged:
          false,
      },
      nextAction:
        "RERUN_CONTRACT_STATIC_AND_IMPORT_SMOKE",
    },
    null,
    2,
  ),
);
