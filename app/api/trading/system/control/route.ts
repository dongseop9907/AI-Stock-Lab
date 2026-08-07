import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase";
import { getTradingSystemControl } from "@/lib/trading/get-trading-system-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ControlAction =
  | "EMERGENCY_STOP"
  | "PAUSE_AUTOMATION"
  | "RESUME_AUTOMATION"
  | "ENABLE_PAPER_ORDERS"
  | "DISABLE_PAPER_ORDERS"
  | "SET_MAX_ORDERS";

interface ControlRequest {
  action?: unknown;
  reason?: unknown;
  maxOrdersPerCycle?: unknown;
  secret?: unknown;
}

function isLocalRequest(
  request: Request,
): boolean {
  try {
    const hostname =
      new URL(
        request.url,
      ).hostname.toLowerCase();

    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

function getReason(
  value: unknown,
): string | null {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const trimmed =
    value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(
    0,
    300,
  );
}

function getMaxOrders(
  value: unknown,
): number | null {
  const parsed =
    Number(value);

  if (
    !Number.isFinite(parsed)
  ) {
    return null;
  }

  const normalized =
    Math.floor(parsed);

  if (
    normalized < 1 ||
    normalized > 5
  ) {
    return null;
  }

  return normalized;
}

export async function GET() {
  try {
    const control =
      await getTradingSystemControl();

    return NextResponse.json({
      ok: true,
      control,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "시스템 제어 상태 조회 실패",
      },
      {
        status: 500,
      },
    );
  }
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
        )) as ControlRequest;

    const expectedSecret =
      process.env
        .TRADING_AUTOMATION_SECRET
        ?.trim() || "";

    const providedSecret =
      request.headers
        .get(
          "x-automation-secret",
        )
        ?.trim() ||
      String(
        body.secret ?? "",
      ).trim();

    if (
      process.env.NODE_ENV ===
        "production" &&
      !isLocalRequest(request) &&
      (
        !expectedSecret ||
        providedSecret !==
          expectedSecret
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "시스템 제어 권한이 없습니다.",
        },
        {
          status: 401,
        },
      );
    }

    const action =
      typeof body.action ===
        "string"
        ? (
            body.action as
              ControlAction
          )
        : null;

    const allowedActions:
      ControlAction[] = [
        "EMERGENCY_STOP",
        "PAUSE_AUTOMATION",
        "RESUME_AUTOMATION",
        "ENABLE_PAPER_ORDERS",
        "DISABLE_PAPER_ORDERS",
        "SET_MAX_ORDERS",
      ];

    if (
      !action ||
      !allowedActions.includes(
        action,
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "지원하지 않는 제어 명령입니다.",
        },
        {
          status: 400,
        },
      );
    }

    const currentControl =
      await getTradingSystemControl();

    const reason =
      getReason(
        body.reason,
      );

    const now =
      new Date().toISOString();

    const updates:
      Record<
        string,
        unknown
      > = {
        updated_at:
          now,

        updated_by:
          "LOCAL_CONTROL_API",
      };

    switch (action) {
      case "EMERGENCY_STOP": {
        updates.automation_enabled =
          false;

        updates.paper_order_enabled =
          false;

        /*
         * 실거래는 어떤 경우에도
         * 함께 비활성화한다.
         */
        updates.real_order_enabled =
          false;

        updates.emergency_stop =
          true;

        updates.emergency_reason =
          reason ??
          "사용자가 비상정지를 실행했습니다.";

        break;
      }

      case "PAUSE_AUTOMATION": {
        updates.automation_enabled =
          false;

        break;
      }

      case "RESUME_AUTOMATION": {
        updates.automation_enabled =
          true;

        updates.emergency_stop =
          false;

        updates.emergency_reason =
          null;

        /*
         * 재개하더라도 주문 생성은
         * 자동으로 켜지지 않는다.
         */
        updates.paper_order_enabled =
          false;

        updates.real_order_enabled =
          false;

        break;
      }

      case "ENABLE_PAPER_ORDERS": {
        if (
          currentControl
            .emergencyStop
        ) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "비상정지 상태에서는 모의주문을 활성화할 수 없습니다.",
            },
            {
              status: 409,
            },
          );
        }

        if (
          !currentControl
            .automationEnabled
        ) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "자동 운영을 먼저 재개해야 합니다.",
            },
            {
              status: 409,
            },
          );
        }

        updates.paper_order_enabled =
          true;

        /*
         * 모의주문을 켜더라도
         * 실거래는 항상 false다.
         */
        updates.real_order_enabled =
          false;

        break;
      }

      case "DISABLE_PAPER_ORDERS": {
        updates.paper_order_enabled =
          false;

        updates.real_order_enabled =
          false;

        break;
      }

      case "SET_MAX_ORDERS": {
        const maxOrders =
          getMaxOrders(
            body.maxOrdersPerCycle,
          );

        if (!maxOrders) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "사이클당 최대 주문 수는 1~5 사이여야 합니다.",
            },
            {
              status: 400,
            },
          );
        }

        updates.max_orders_per_cycle =
          maxOrders;

        break;
      }
    }

    const supabase =
      createSupabaseServerClient();

    const {
      data,
      error,
    } = await supabase
      .from(
        "trading_system_controls",
      )
      .update(
        updates,
      )
      .eq(
        "control_key",
        "global",
      )
      .select(`
        control_key,
        automation_enabled,
        paper_order_enabled,
        real_order_enabled,
        emergency_stop,
        emergency_reason,
        max_orders_per_cycle,
        updated_by,
        updated_at
      `)
      .single();

    if (error) {
      throw new Error(
        `시스템 제어 상태 변경 실패: ${error.message}`,
      );
    }

    return NextResponse.json({
      ok: true,
      action,
      control: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "시스템 제어 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}