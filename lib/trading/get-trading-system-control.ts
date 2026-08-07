import { createSupabaseServerClient } from "@/lib/supabase";

export interface TradingSystemControl {
  controlKey: string;

  automationEnabled: boolean;
  paperOrderEnabled: boolean;
  realOrderEnabled: boolean;
  emergencyStop: boolean;

  emergencyReason: string | null;

  maxOrdersPerCycle: number;

  updatedBy: string;
  updatedAt: string;
}

interface ControlRecord {
  control_key: string;

  automation_enabled: boolean;
  paper_order_enabled: boolean;
  real_order_enabled: boolean;
  emergency_stop: boolean;

  emergency_reason: string | null;

  max_orders_per_cycle:
    | number
    | string;

  updated_by: string;
  updated_at: string;
}

function mapControl(
  record: ControlRecord,
): TradingSystemControl {
  const parsedMaxOrders =
    Number(
      record.max_orders_per_cycle,
    );

  return {
    controlKey:
      record.control_key,

    automationEnabled:
      record.automation_enabled,

    paperOrderEnabled:
      record.paper_order_enabled,

    realOrderEnabled:
      record.real_order_enabled,

    emergencyStop:
      record.emergency_stop,

    emergencyReason:
      record.emergency_reason,

    maxOrdersPerCycle:
      Number.isFinite(
        parsedMaxOrders,
      )
        ? Math.max(
            1,
            Math.min(
              5,
              Math.floor(
                parsedMaxOrders,
              ),
            ),
          )
        : 1,

    updatedBy:
      record.updated_by,

    updatedAt:
      record.updated_at,
  };
}

export async function getTradingSystemControl(): Promise<TradingSystemControl> {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } = await supabase
    .from(
      "trading_system_controls",
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
    .eq(
      "control_key",
      "global",
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `시스템 제어 상태 조회 실패: ${error.message}`,
    );
  }

  if (data) {
    return mapControl(
      data as ControlRecord,
    );
  }

  const {
    data: createdData,
    error: createError,
  } = await supabase
    .from(
      "trading_system_controls",
    )
    .insert({
      control_key:
        "global",

      automation_enabled:
        true,

      paper_order_enabled:
        false,

      real_order_enabled:
        false,

      emergency_stop:
        false,

      emergency_reason:
        null,

      max_orders_per_cycle:
        1,

      updated_by:
        "SYSTEM",
    })
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

  if (createError) {
    throw new Error(
      `시스템 제어 상태 생성 실패: ${createError.message}`,
    );
  }

  return mapControl(
    createdData as ControlRecord,
  );
}