import {
  NextRequest,
  NextResponse,
} from "next/server";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

function parseBoolean(
  value: unknown,
  fallback: boolean,
) {
  if (
    typeof value ===
    "boolean"
  ) {
    return value;
  }

  if (
    typeof value ===
    "string"
  ) {
    const normalized =
      value
        .trim()
        .toLowerCase();

    if (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "on"
    ) {
      return true;
    }

    if (
      normalized === "false" ||
      normalized === "0" ||
      normalized === "no" ||
      normalized === "off"
    ) {
      return false;
    }
  }

  return fallback;
}

function clampMaxOrders(
  value: unknown,
) {
  const parsed =
    typeof value ===
    "number"
      ? value
      : Number(
          value,
        );

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return 1;
  }

  return Math.max(
    1,
    Math.min(
      5,
      Math.floor(
        parsed,
      ),
    ),
  );
}

function isAllowedManualOrigin(
  request: NextRequest,
) {
  const requestUrl =
    new URL(
      request.url,
    );

  const origin =
    request.headers
      .get(
        "origin",
      )
      ?.trim();

  if (origin) {
    return (
      origin ===
      requestUrl.origin
    );
  }

  /*
   * Browsers normally send Origin for this POST.
   * No-Origin requests are allowed only for local development.
   */
  const hostname =
    requestUrl.hostname
      .toLowerCase();

  return (
    hostname ===
      "localhost" ||
    hostname ===
      "127.0.0.1" ||
    hostname ===
      "::1"
  );
}

export async function POST(
  request: NextRequest,
) {
  if (
    !isAllowedManualOrigin(
      request,
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "AUTOMATION_MANUAL_ORIGIN_REJECTED",
      },
      {
        status: 403,
      },
    );
  }

  const secret =
    process.env
      .TRADING_AUTOMATION_SECRET
      ?.trim() ??
    "";

  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "TRADING_AUTOMATION_SECRET_NOT_CONFIGURED",
      },
      {
        status: 503,
      },
    );
  }

  const body =
    (await request
      .json()
      .catch(
        () => ({}),
      )) as {
      includeMarketSync?: unknown;
      autoOrder?: unknown;
      maxOrders?: unknown;
      probeOnly?: unknown;
    };

  /*
   * ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_V1
   *
   * Same-origin browser callers may request probeOnly=true.
   * The server adds the secret and forwards only the cycle's
   * zero-side-effect probe branch.
   */
  const probeOnly =
    body.probeOnly ===
      true;

  /*
   * Only the intended manual controls are forwarded.
   * scheduler/arbitrary caller fields are discarded.
   */
  const forwardedBody =
    probeOnly
      ? {
          triggerType:
            "MANUAL",

          probeOnly:
            true,

          includeMarketSync:
            false,

          autoOrder:
            false,

          maxOrders:
            1,
        }
      : {
    triggerType:
      "MANUAL",

    includeMarketSync:
      parseBoolean(
        body.includeMarketSync,
        true,
      ),

    autoOrder:
      parseBoolean(
        body.autoOrder,
        false,
      ),

    maxOrders:
      clampMaxOrders(
        body.maxOrders,
      ),
  };

  const origin =
    new URL(
      request.url,
    ).origin;

  const response =
    await fetch(
      `${origin}/api/trading/automation/cycle`,
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/json; charset=utf-8",

          "x-automation-secret":
            secret,
        },

        body:
          JSON.stringify(
            forwardedBody,
          ),

        cache:
          "no-store",
      },
    );

  const responseText =
    await response.text();

  return new NextResponse(
    responseText,
    {
      status:
        response.status,

      headers: {
        "content-type":
          response.headers.get(
            "content-type",
          ) ??
          "application/json; charset=utf-8",
      },
    },
  );
}
