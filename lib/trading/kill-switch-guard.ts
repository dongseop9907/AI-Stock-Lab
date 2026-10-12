import {
  evaluateKillSwitchAction,
  type KillSwitchAction,
  type KillSwitchDecision,
} from "@/lib/trading/kill-switch-contract";
import {
  getTradingSystemControl,
  type TradingSystemControl,
} from "@/lib/trading/get-trading-system-control";

export class KillSwitchBlockedError extends Error {
  readonly code =
    "KILL_SWITCH_ACTION_BLOCKED";

  readonly action: KillSwitchAction;
  readonly decision: KillSwitchDecision;

  constructor(
    action: KillSwitchAction,
    decision: KillSwitchDecision,
  ) {
    super(
      [
        "KILL_SWITCH_ACTION_BLOCKED",
        action,
        decision.reason,
      ].join(":"),
    );

    this.name =
      "KillSwitchBlockedError";

    this.action =
      action;

    this.decision =
      decision;
  }
}

export async function evaluateCurrentKillSwitchAction(
  action: KillSwitchAction,
): Promise<{
  control: TradingSystemControl;
  decision: KillSwitchDecision;
}> {
  const control =
    await getTradingSystemControl();

  const decision =
    evaluateKillSwitchAction(
      {
        emergencyStop:
          control.emergencyStop,

        automationEnabled:
          control.automationEnabled,

        paperOrderEnabled:
          control.paperOrderEnabled,

        realOrderEnabled:
          control.realOrderEnabled,
      },
      action,
    );

  return {
    control,
    decision,
  };
}

export async function assertKillSwitchAllows(
  action: KillSwitchAction,
): Promise<{
  control: TradingSystemControl;
  decision: KillSwitchDecision;
}> {
  const result =
    await evaluateCurrentKillSwitchAction(
      action,
    );

  if (!result.decision.allowed) {
    throw new KillSwitchBlockedError(
      action,
      result.decision,
    );
  }

  return result;
}
