import {
  NextResponse,
} from "next/server";

import {
  runMarketEodSyncV78,
} from "@/lib/market/run-market-eod-sync-v7-8";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface RequestBody {
  lookbackCalendarDays?: unknown;

  skipIfAlreadyFresh?: unknown;

  now?: unknown;
}

function optionalNumber(
  value: unknown,
): number | undefined {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return undefined;
  }

  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : undefined;
}

function optionalBoolean(
  value: unknown,
): boolean | undefined {
  return typeof value ===
    "boolean"
    ? value
    : undefined;
}

function optionalString(
  value: unknown,
): string | undefined {
  return typeof value ===
    "string" &&
    value.trim()
      ? value.trim()
      : undefined;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as RequestBody;

    const result =
      await runMarketEodSyncV78({
        lookbackCalendarDays:
          optionalNumber(
            body
              .lookbackCalendarDays,
          ),

        skipIfAlreadyFresh:
          optionalBoolean(
            body
              .skipIfAlreadyFresh,
          ),

        now:
          optionalString(
            body.now,
          ),
      });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "Market EOD synchronization failed.",
      },
      {
        status: 500,
      },
    );
  }
}