import type {
  AlphaFeatureEvidence,
} from "./candidate-scoring";

import type {
  KisDomesticInvestorTrendOutput,
} from "../kis/client";

export interface KisInvestorFlowAdapterInput {
  decisionAt: string;
  rows: KisDomesticInvestorTrendOutput[];
  lookbackRows?: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function parseDecisionAt(value: string): number {
  const parsed = new Date(value).getTime();

  if (!Number.isFinite(parsed)) {
    throw new Error(
      `INVALID_DECISION_AT:${value}`,
    );
  }

  return parsed;
}

function tradingDateToConservativeAvailableAt(
  yyyymmdd: string,
): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) {
    return null;
  }

  const year =
    Number(yyyymmdd.slice(0, 4));

  const month =
    Number(yyyymmdd.slice(4, 6));

  const day =
    Number(yyyymmdd.slice(6, 8));

  /**
   * Conservative availability contract:
   * treat a Korean trading day's final investor-flow aggregate as
   * available only at the next 00:00 KST.
   *
   * 00:00 KST of the following calendar day = 15:00 UTC on trading date.
   *
   * This automatically prevents the still-open/current trading day's
   * placeholder zero row from leaking into a decision made during the day.
   */
  const utcMs =
    Date.UTC(
      year,
      month - 1,
      day,
      15,
      0,
      0,
      0,
    );

  const date =
    new Date(utcMs);

  return Number.isFinite(date.getTime())
    ? date.toISOString()
    : null;
}

function flowValues(
  row: KisDomesticInvestorTrendOutput,
) {
  const foreignAmount =
    toNumber(
      row.frgn_ntby_tr_pbmn,
    );

  const institutionAmount =
    toNumber(
      row.orgn_ntby_tr_pbmn,
    );

  const individualAmount =
    toNumber(
      row.prsn_ntby_tr_pbmn,
    );

  const amountUsable =
    foreignAmount !== null ||
    institutionAmount !== null ||
    individualAmount !== null;

  if (amountUsable) {
    return {
      basis:
        "NET_BUY_TRADING_AMOUNT" as const,

      foreign:
        foreignAmount ?? 0,

      institution:
        institutionAmount ?? 0,

      individual:
        individualAmount ?? 0,
    };
  }

  return {
    basis:
      "NET_BUY_QUANTITY_FALLBACK" as const,

    foreign:
      toNumber(
        row.frgn_ntby_qty,
      ) ?? 0,

    institution:
      toNumber(
        row.orgn_ntby_qty,
      ) ?? 0,

    individual:
      toNumber(
        row.prsn_ntby_qty,
      ) ?? 0,
  };
}

export function buildKisInvestorFlowEvidence(
  input: KisInvestorFlowAdapterInput,
): AlphaFeatureEvidence | undefined {
  const decisionAtMs =
    parseDecisionAt(
      input.decisionAt,
    );

  const lookbackRows =
    Math.max(
      3,
      Math.min(
        20,
        Math.floor(
          input.lookbackRows ?? 7,
        ),
      ),
    );

  const usable =
    input.rows
      .map((row) => {
        const tradingDate =
          String(
            row.stck_bsop_date ?? "",
          ).trim();

        const availableAt =
          tradingDateToConservativeAvailableAt(
            tradingDate,
          );

        const availableAtMs =
          availableAt
            ? new Date(
                availableAt,
              ).getTime()
            : Number.NaN;

        const values =
          flowValues(row);

        const smartMoneyNet =
          values.foreign +
          values.institution;

        const grossParticipantNet =
          Math.abs(
            values.foreign,
          ) +
          Math.abs(
            values.institution,
          ) +
          Math.abs(
            values.individual,
          );

        const normalized =
          grossParticipantNet > 0
            ? Math.max(
                -1,
                Math.min(
                  1,
                  smartMoneyNet /
                    grossParticipantNet,
                ),
              )
            : 0;

        return {
          row,
          tradingDate,
          availableAt,
          availableAtMs,
          basis:
            values.basis,
          foreign:
            values.foreign,
          institution:
            values.institution,
          individual:
            values.individual,
          smartMoneyNet,
          grossParticipantNet,
          normalized,
        };
      })
      .filter(
        (row) =>
          row.availableAt !== null &&
          Number.isFinite(
            row.availableAtMs,
          ) &&
          row.availableAtMs <=
            decisionAtMs &&
          row.grossParticipantNet > 0,
      )
      .sort(
        (a, b) =>
          b.tradingDate.localeCompare(
            a.tradingDate,
          ),
      )
      .slice(
        0,
        lookbackRows,
      );

  if (usable.length === 0) {
    return undefined;
  }

  let weightedNormalized = 0;
  let totalWeight = 0;
  let positiveWeight = 0;
  let negativeWeight = 0;

  usable.forEach(
    (row, index) => {
      /**
       * Newer completed trading days matter more.
       */
      const recencyWeight =
        Math.pow(
          0.78,
          index,
        );

      weightedNormalized +=
        row.normalized *
        recencyWeight;

      totalWeight +=
        recencyWeight;

      if (
        row.smartMoneyNet > 0
      ) {
        positiveWeight +=
          recencyWeight;
      } else if (
        row.smartMoneyNet < 0
      ) {
        negativeWeight +=
          recencyWeight;
      }
    },
  );

  if (totalWeight <= 0) {
    return undefined;
  }

  const meanNormalized =
    weightedNormalized /
    totalWeight;

  const directionalWeight =
    positiveWeight +
    negativeWeight;

  const signedConsistency =
    directionalWeight > 0
      ? (
          positiveWeight -
          negativeWeight
        ) /
        directionalWeight
      : 0;

  const pressureScore =
    clamp01(
      0.5 +
      meanNormalized *
        0.5,
    );

  const consistencyScore =
    clamp01(
      0.5 +
      signedConsistency *
        0.5,
    );

  /**
   * 75% actual normalized smart-money pressure
   * 25% directional persistence.
   */
  const score =
    clamp01(
      pressureScore *
        0.75 +
      consistencyScore *
        0.25,
    );

  const amountRows =
    usable.filter(
      (row) =>
        row.basis ===
        "NET_BUY_TRADING_AMOUNT",
    ).length;

  const amountCoverage =
    amountRows /
    usable.length;

  const historyCoverage =
    clamp01(
      usable.length /
      lookbackRows,
    );

  const nonZeroDirectionCoverage =
    directionalWeight > 0
      ? 1
      : 0;

  const confidence =
    clamp01(
      0.45 +
      amountCoverage *
        0.20 +
      historyCoverage *
        0.20 +
      nonZeroDirectionCoverage *
        0.10,
    );

  const latest =
    usable[0];

  return {
    score,
    confidence,

    availableAt:
      latest.availableAt as string,

    observedAt:
      latest.availableAt as string,

    source:
      "KIS_INQUIRE_INVESTOR",

    sourceVersion:
      "FHKST01010900_ALPHA_FLOW_V1",

    /**
     * Allows long weekends/holidays while still rejecting very stale flow.
     */
    maxAgeMinutes:
      10 * 24 * 60,

    metadata: {
      lookbackRows,
      usableRows:
        usable.length,

      latestCompletedTradingDate:
        latest.tradingDate,

      amountRows,
      quantityFallbackRows:
        usable.length -
        amountRows,

      meanNormalized,
      signedConsistency,
      pressureScore,
      consistencyScore,

      positiveWeight,
      negativeWeight,

      rows:
        usable.map(
          (row) => ({
            tradingDate:
              row.tradingDate,

            availableAt:
              row.availableAt,

            basis:
              row.basis,

            foreign:
              row.foreign,

            institution:
              row.institution,

            individual:
              row.individual,

            smartMoneyNet:
              row.smartMoneyNet,

            normalized:
              row.normalized,
          }),
        ),
    },
  };
}
