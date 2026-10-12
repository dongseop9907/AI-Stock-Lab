import {
  assertModelPromotionAllowsPaperRisk,
  resolveModelPromotionGate,
} from "../lib/models/model-promotion-gate";

async function expectPaperBlocked(
  modelId: string,
  expectedStage: string,
) {
  const model =
    await resolveModelPromotionGate(
      modelId,
    );

  if (
    model.promotionStage !==
      expectedStage
  ) {
    throw new Error(
      `UNEXPECTED_STAGE:${modelId}:${model.promotionStage}:${expectedStage}`,
    );
  }

  let blocked = false;

  try {
    await assertModelPromotionAllowsPaperRisk(
      modelId,
      "READ_ONLY_CONTRACT_TEST",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    blocked =
      message.startsWith(
        "MODEL_PROMOTION_PAPER_RISK_BLOCKED:",
      );
  }

  if (!blocked) {
    throw new Error(
      `EXPECTED_PAPER_RISK_BLOCK:${modelId}:${expectedStage}`,
    );
  }
}

async function expectPaperAllowed(
  modelId: string,
  expectedStage: string,
) {
  const model =
    await assertModelPromotionAllowsPaperRisk(
      modelId,
      "READ_ONLY_CONTRACT_TEST",
    );

  if (
    model.promotionStage !==
      expectedStage
  ) {
    throw new Error(
      `UNEXPECTED_STAGE:${modelId}:${model.promotionStage}:${expectedStage}`,
    );
  }
}

async function main() {
  await expectPaperAllowed(
    "4ad531c1-021e-4787-9e32-ec91600ba740",
    "PAPER",
  );

  await expectPaperBlocked(
    "e0f01680-6b43-4251-8d88-cfbffab78213",
    "DISABLED",
  );

  await expectPaperBlocked(
    "3045646b-599b-41cd-9650-43e539fb7a95",
    "CANDIDATE",
  );

  console.log(
    JSON.stringify(
      {
        status:
          "MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_DB_READ_CONTRACT_VERIFIED",
        cases: {
          PAPER_ALLOWED: 1,
          DISABLED_BLOCKED: 1,
          CANDIDATE_BLOCKED: 1,
        },
        safety: {
          databaseReadsOnly: true,
          databaseWrites: 0,
          ordersCreated: 0,
          positionsChanged: 0,
          controlsChanged: false,
          realTradingChanged: false,
        },
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
            "MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_DB_READ_CONTRACT_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            databaseWrites: 0,
            ordersCreated: 0,
            positionsChanged: 0,
            controlsChanged: false,
            realTradingChanged: false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
