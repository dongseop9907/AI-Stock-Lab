import assert from "node:assert/strict";

import {
  buildFirstRealSessionReadinessV1,
} from "./true-forward-oos-first-real-session-readiness-v1";

function main() {
  const result =
    buildFirstRealSessionReadinessV1();

  const structuralChecks = {
    hasTargetDate:
      result.target.tradingDate ===
      "2026-10-12",

    controlledWindowFrozen:
      result.target.controlledWindow ===
      "08:45-08:59 KST",

    persistentAutomationOff:
      result.target.persistentAutomation ===
      "OFF",

    hangeulRegression:
      result.checks
        .hangeulDayNextOpenRegression ===
        true,

    targetKrxTradingDate:
      result.checks
        .targetDateIsKrxTradingDate ===
        true,

    krxMaturityBound:
      result.checks
        .maturityUsesKrxTradingSessions ===
        true,

    collectorSingleRun:
      result.checks
        .collectorSingleRunBinding ===
        true,

    unsupportedHorizonRemoved:
      result.checks
        .collectorNoUnsupportedHorizonCli ===
        true,

    noRealTrading:
      result.checks
        .noRealTradingFlagEnabled ===
        true,

    noProducerExecution:
      result.safety
        .producerExecuted ===
        false,

    noTradingSideEffects:
      result.safety
        .ordersCreated ===
        0 &&
      result.safety
        .positionsChanged ===
        0 &&
      result.safety
        .promotionExecuted ===
        false,
  };

  const failed =
    Object.entries(
      structuralChecks,
    )
      .filter(
        ([, value]) =>
          value !==
          true,
      )
      .map(
        ([key]) =>
          key,
      );

  for (
    const [
      key,
      value,
    ] of Object.entries(
      structuralChecks,
    )
  ) {
    assert.equal(
      value,
      true,
      key,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_CONTRACT_VERIFIED",

        checks:
          structuralChecks,

        currentReadinessStatus:
          result.readinessStatus,

        currentFailed:
          result.failed,

        safety:
          result.safety,

        failed,

        nextGate:
          "RUN_CURRENT_FIRST_REAL_SESSION_READINESS",
      },
      null,
      2,
    ),
  );
}

main();
