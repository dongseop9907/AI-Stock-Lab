import * as executePaperModule from "../lib/trading/execute-paper-order";
import * as approvedModule from "../lib/trading/execute-approved-paper-orders";
import * as safeResolverModule from "../lib/trading/resolve-safe-paper-buy-execution";
import * as priceResolverModule from "../lib/trading/paper-execution-price-resolver";
import * as riskModule from "../lib/trading/gap-slippage-risk";

function exportedFunctions(moduleObject: Record<string, unknown>) {
  return Object.entries(moduleObject)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();
}

const result = {
  status: "ALPHA_V3_GAP_SLIPPAGE_POST_DB_TYPESCRIPT_SMOKE_V1_VERIFIED",
  modules: {
    executePaperOrder: exportedFunctions(executePaperModule),
    executeApprovedPaperOrders: exportedFunctions(approvedModule),
    safePaperBuyExecution: exportedFunctions(safeResolverModule),
    paperExecutionPriceResolver: exportedFunctions(priceResolverModule),
    gapSlippageRisk: exportedFunctions(riskModule),
  },
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    ordersExecuted: 0,
    positionsChanged: 0,
  },
};

console.log(JSON.stringify(result, null, 2));
