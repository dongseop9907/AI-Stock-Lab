const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    const i = line.indexOf("=");

    if (i <= 0) continue;

    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(path.join(process.cwd(), ".env.local"));

const base =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !key) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_RUN_FAILED",
    reason:
      "SUPABASE_ENV_MISSING",
  }, null, 2));

  process.exitCode = 1;
  return;
}

(async () => {
  try {
    const res = await fetch(
      base +
      "/rest/v1/rpc/run_paper_order_terminal_state_contract_regression_v1_1",
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization:
            "Bearer " + key,
          "Content-Type":
            "application/json",
        },
        body: "{}",
      }
    );

    const text = await res.text();

    let body;

    try {
      body =
        text
          ? JSON.parse(text)
          : null;
    } catch {
      body = text;
    }

    console.log(JSON.stringify({
      http: {
        ok: res.ok,
        status: res.status,
      },
      result: body,
    }, null, 2));

    process.exitCode =
      res.ok &&
      body &&
      body.status ===
        "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_PASS"
        ? 0
        : 1;

  } catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_RUN_FAILED",
      reason:
        error instanceof Error
          ? error.message
          : String(error),
    }, null, 2));

    process.exitCode = 1;
  }
})();
