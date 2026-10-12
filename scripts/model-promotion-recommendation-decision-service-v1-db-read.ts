import {
  evaluateModelPromotionRecommendation,
} from "../lib/models/model-promotion-decision-service";

async function main() {
  const candidateId =
    "3045646b-599b-41cd-9650-43e539fb7a95";

  const result =
    await evaluateModelPromotionRecommendation(
      candidateId,
    );

  if (
    result.fromStage !==
      "CANDIDATE"
  ) {
    throw new Error(
      `EXPECTED_CANDIDATE_STAGE:${result.fromStage}`,
    );
  }

  if (
    result.toStage !==
      "SHADOW"
  ) {
    throw new Error(
      `EXPECTED_SHADOW_TARGET:${result.toStage}`,
    );
  }

  if (
    result
      .evidence
      .entrySignals
      .total <=
      0
  ) {
    throw new Error(
      "EXPECTED_MODEL_LINKED_ENTRY_SIGNALS",
    );
  }

  if (
    result.decision !==
      "RECOMMENDED"
  ) {
    throw new Error(
      `EXPECTED_SHADOW_RECOMMENDATION:${result.decision}:${result.reason}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "MODEL_PROMOTION_RECOMMENDATION_DECISION_SERVICE_V1_DB_READ_VERIFIED",
        modelId:
          result.modelId,
        fromStage:
          result.fromStage,
        toStage:
          result.toStage,
        decision:
          result.decision,
        reason:
          result.reason,
        evidence: {
          entrySignals:
            result
              .evidence
              .entrySignals,
          paperTrades:
            result
              .evidence
              .paperTrades,
          validationTradeCount:
            result
              .evidence
              .validationTradeCount,
          metrics:
            result
              .evidence
              .metrics,
        },
        safety:
          result.safety,
        promotionEventWritten:
          false,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_PROMOTION_RECOMMENDATION_DECISION_SERVICE_V1_DB_READ_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            databaseReadsOnly:
              true,
            databaseWrites:
              0,
            promotionEventsWritten:
              0,
            promotionStageChanged:
              false,
            ordersCreated:
              0,
            positionsChanged:
              0,
            realTradingChanged:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
