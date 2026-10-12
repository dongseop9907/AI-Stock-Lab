const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const idx = line.indexOf("=");

    if (idx <= 0) continue;

    const key =
      line.slice(0, idx).trim();

    let value =
      line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value =
        value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(
  path.join(process.cwd(), ".env.local")
);

const BASE =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !KEY) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_RUN_FAILED",
    reason:
      "SUPABASE_ENV_MISSING",
  }, null, 2));

  process.exitCode = 1;
  return;
}

(async () => {
  try {
    const res = await fetch(
      BASE +
      "/rest/v1/rpc/run_paper_accounting_numeric_reconciliation_v1",
      {
        method: "POST",
        headers: {
          apikey: KEY,
          Authorization:
            "Bearer " + KEY,
          "Content-Type":
            "application/json",
        },
        body: "{}",
      },
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

    const output = {
      http: {
        ok: res.ok,
        status: res.status,
      },
      result: body,
    };

    console.log(
      JSON.stringify(
        output,
        null,
        2,
      ),
    );

    const pass =
      res.ok &&
      body &&
      body.status ===
        "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_PASS";

    process.exitCode =
      pass
        ? 0
        : 1;
  } catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_RUN_FAILED",

      reason:
        error instanceof Error
          ? error.message
          : String(error),
    }, null, 2));

    process.exitCode = 1;
  }
})();
