import assert from "node:assert/strict";

import {
  buildKisInvestorFlowEvidence,
} from "../lib/alpha/kis-flow-adapter";

const decisionAt =
  "2026-10-06T05:45:00.000Z";

const evidence =
  buildKisInvestorFlowEvidence({
    decisionAt,

    lookbackRows:
      5,

    rows: [
      /**
       * Current trading day placeholder.
       * Conservative availability contract must exclude it.
       */
      {
        stck_bsop_date:
          "20261006",

        frgn_ntby_tr_pbmn:
          0,

        orgn_ntby_tr_pbmn:
          0,

        prsn_ntby_tr_pbmn:
          0,
      },

      {
        stck_bsop_date:
          "20261002",

        frgn_ntby_tr_pbmn:
          -120,

        orgn_ntby_tr_pbmn:
          220,

        prsn_ntby_tr_pbmn:
          -100,
      },

      {
        stck_bsop_date:
          "20261001",

        frgn_ntby_tr_pbmn:
          50,

        orgn_ntby_tr_pbmn:
          150,

        prsn_ntby_tr_pbmn:
          -200,
      },

      {
        stck_bsop_date:
          "20260930",

        frgn_ntby_tr_pbmn:
          -40,

        orgn_ntby_tr_pbmn:
          120,

        prsn_ntby_tr_pbmn:
          -80,
      },

      {
        stck_bsop_date:
          "20260929",

        frgn_ntby_tr_pbmn:
          80,

        orgn_ntby_tr_pbmn:
          100,

        prsn_ntby_tr_pbmn:
          -180,
      },

      {
        stck_bsop_date:
          "20260928",

        frgn_ntby_tr_pbmn:
          90,

        orgn_ntby_tr_pbmn:
          110,

        prsn_ntby_tr_pbmn:
          -200,
      },
    ],
  });

assert(
  evidence,
  "flow evidence missing",
);

assert.equal(
  evidence.source,
  "KIS_INQUIRE_INVESTOR",
);

assert.equal(
  evidence.metadata
    ?.latestCompletedTradingDate,
  "20261002",
  "current trading day leaked into completed flow evidence",
);

assert.equal(
  evidence.metadata
    ?.usableRows,
  5,
);

assert(
  evidence.score >
    0.5,
  "positive smart-money history should score above neutral",
);

assert(
  evidence.confidence >=
    0.8,
  "five amount-based rows should have high confidence",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V1_KIS_FLOW_ADAPTER_SMOKE_PASS",

      score:
        evidence.score,

      confidence:
        evidence.confidence,

      availableAt:
        evidence.availableAt,

      metadata:
        evidence.metadata,

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        networkRequests:
          0,

        ordersCreated:
          0,
      },

      nextGate:
        "ALPHA_V1_BIND_KIS_FLOW_TO_REAL_RUNNER",
    },
    null,
    2,
  ),
);
