import { createSupabaseServerClient } from "../lib/supabase";

const RUN_ID =
  "5c2b20cb-a468-4575-b9b6-cedb4841b043";

function describe(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      sampleKeys:
        value.length > 0 &&
        value[0] &&
        typeof value[0] === "object"
          ? Object.keys(
              value[0] as Record<string, unknown>,
            )
          : [],
    };
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const obj =
      value as Record<string, unknown>;

    return {
      kind: "object",
      keys: Object.keys(obj),
    };
  }

  return {
    kind: typeof value,
    value:
      typeof value === "string" &&
      value.length > 120
        ? `${value.slice(0, 120)}...`
        : value,
  };
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "corporate_action_source_inventory_pages",
      )
      .select("*")
      .eq(
        "run_id",
        RUN_ID,
      )
      .order(
        "chunk_start",
        {
          ascending: true,
        },
      )
      .order(
        "corp_cls",
        {
          ascending: true,
        },
      )
      .order(
        "page_no",
        {
          ascending: true,
        },
      )
      .limit(3);

  if (error) {
    throw new Error(
      `INVENTORY_PAGE_QUERY_FAILED:${error.message}`,
    );
  }

  const rows =
    data ?? [];

  console.log(
    JSON.stringify(
      {
        version:
          "V9_7_DB_INVENTORY_PAGE_SCHEMA_PROBE_V1",

        runId:
          RUN_ID,

        rowCount:
          rows.length,

        rows:
          rows.map(
            (row, index) => ({
              index,

              columns:
                Object.keys(row),

              structure:
                Object.fromEntries(
                  Object.entries(row)
                    .map(
                      ([key, value]) => [
                        key,
                        describe(value),
                      ],
                    ),
                ),
            }),
          ),

        safety: {
          databaseReadsOnly: true,
          databaseWrites: 0,
          networkRequestsToOpenDart: 0,
          coverageWindowAdvanced: false,
        },
      },
      null,
      2,
    ),
  );
}

main().catch(
  error => {
    console.error(
      error instanceof Error
        ? error.stack
        : error,
    );

    process.exitCode = 1;
  },
);
