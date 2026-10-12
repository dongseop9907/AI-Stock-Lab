const RPC_NAME =
  "execute_paper_buy_order_with_execution_price_v3";

const REQUIRED_ARGS = [
  "p_order_id",
  "p_execution_price",
  "p_execution_observed_at",
  "p_execution_price_source",
  "p_execution_provenance",
  "p_fill_quantity",
  "p_broker_fee",
] as const;

function firstEnv(
  names: string[],
): {
  name: string | null;
  value: string | null;
} {
  for (const name of names) {
    const value =
      process.env[name]?.trim();

    if (value) {
      return {
        name,
        value,
      };
    }
  }

  return {
    name:
      null,
    value:
      null,
  };
}

async function main() {
  const urlEnv =
    firstEnv([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    ]);

  const keyEnv =
    firstEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    ]);

  if (
    !urlEnv.value ||
    !keyEnv.value
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_REMOTE_RPC_EXISTENCE_PROBE_FAIL",

          reason:
            "SUPABASE_ENV_NOT_FOUND",

          env: {
            urlEnvName:
              urlEnv.name,
            keyEnvName:
              keyEnv.name,
          },

          secretsPrinted:
            false,
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  const baseUrl =
    urlEnv.value.replace(
      /\/+$/,
      "",
    );

  const endpoint =
    `${baseUrl}/rest/v1/`;

  const startedAt =
    Date.now();

  let response:
    Response;

  try {
    response =
      await fetch(
        endpoint,
        {
          method:
            "GET",

          headers: {
            apikey:
              keyEnv.value,

            Authorization:
              `Bearer ${keyEnv.value}`,

            Accept:
              "application/openapi+json",

            "Accept-Profile":
              "public",
          },
        },
      );
  }
  catch (error) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_REMOTE_RPC_EXISTENCE_PROBE_FAIL",

          reason:
            "POSTGREST_OPENAPI_REQUEST_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            httpMethod:
              "GET",
            rpcInvoked:
              false,
            databaseWrites:
              0,
            ordersCreated:
              0,
            ordersExecuted:
              0,
            positionsChanged:
              0,
            realTradingEnabled:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  const elapsedMs =
    Date.now() -
    startedAt;

  const contentType =
    response.headers.get(
      "content-type",
    );

  const bodyText =
    await response.text();

  let schema:
    unknown =
      null;

  try {
    schema =
      JSON.parse(
        bodyText,
      );
  }
  catch {
    schema =
      null;
  }

  const schemaRecord =
    (
      schema &&
      typeof schema ===
        "object"
    )
      ? schema as
          Record<string, unknown>
      : null;

  const paths =
    (
      schemaRecord?.paths &&
      typeof schemaRecord.paths ===
        "object"
    )
      ? schemaRecord.paths as
          Record<string, unknown>
      : {};

  const rpcPath =
    `/rpc/${RPC_NAME}`;

  const rpcDefinition =
    paths[rpcPath] ??
    null;

  const rpcDefinitionText =
    rpcDefinition
      ? JSON.stringify(
          rpcDefinition,
        )
      : "";

  const argPresence =
    Object.fromEntries(
      REQUIRED_ARGS.map(
        arg => [
          arg,
          rpcDefinitionText.includes(
            arg,
          ),
        ],
      ),
    ) as Record<
      string,
      boolean
    >;

  const missingArgs =
    Object.entries(
      argPresence,
    )
      .filter(
        ([, present]) =>
          !present,
      )
      .map(
        ([name]) =>
          name,
      );

  const definitionRecord =
    (
      rpcDefinition &&
      typeof rpcDefinition ===
        "object"
    )
      ? rpcDefinition as
          Record<string, unknown>
      : {};

  const checks = {
    httpOk:
      response.ok,

    openApiJsonParsed:
      schemaRecord !==
      null,

    rpcPathExists:
      rpcDefinition !==
      null,

    postMethodExposed:
      Boolean(
        definitionRecord.post,
      ),

    allExpectedArgsVisible:
      missingArgs.length ===
      0,

    noRpcInvocation:
      true,

    noDatabaseWrite:
      true,
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, ok]) =>
          ok !== true,
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
            ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_REMOTE_RPC_EXISTENCE_PROBE_PASS"
            : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_REMOTE_RPC_EXISTENCE_PROBE_FAIL",

        target: {
          rpc:
            RPC_NAME,

          path:
            rpcPath,
        },

        api: {
          httpStatus:
            response.status,

          contentType,

          elapsedMs,
        },

        auth: {
          urlEnvName:
            urlEnv.name,

          keyEnvName:
            keyEnv.name,

          keyPrinted:
            false,
        },

        rpc: {
          pathExists:
            rpcDefinition !==
            null,

          postMethodExposed:
            Boolean(
              definitionRecord.post,
            ),

          expectedArgs:
            REQUIRED_ARGS,

          argPresence,

          missingArgs,
        },

        checks,
        failed,

        safety: {
          httpMethod:
            "GET",

          openApiSchemaOnly:
            true,

          rpcInvoked:
            false,

          databaseReads:
            0,

          databaseWrites:
            0,

          ordersCreated:
            0,

          ordersExecuted:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,

          secretPrinted:
            false,
        },

        nextGate:
          failed.length ===
            0
            ? "PAPER_EXECUTION_PROVENANCE_RUNTIME_NATURAL_FILL_EVIDENCE_WAIT"
            : "REVIEW_REMOTE_RPC_SCHEMA_EXPOSURE",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
      0
      ? 0
      : 1;
}

void main();
