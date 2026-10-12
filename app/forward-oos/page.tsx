import {
  getForwardOosObservabilityDashboardV1,
} from "@/lib/research/get-forward-oos-observability-dashboard-v1";

export const dynamic =
  "force-dynamic";

function pct(
  value: number | null,
) {
  if (
    value === null ||
    !Number.isFinite(
      value,
    )
  ) {
    return "-";
  }

  return `${(
    value *
    100
  ).toFixed(1)}%`;
}

function yesNo(
  value: boolean,
) {
  return value
    ? "PASS"
    : "WAIT";
}

function tone(
  value: boolean,
) {
  return value
    ? "#157347"
    : "#9a6700";
}

export default function ForwardOosPage() {
  const data =
    getForwardOosObservabilityDashboardV1();

  const cards = [
    {
      label:
        "Forward Sessions",
      value:
        String(
          data.sessions.total,
        ),
      sub:
        `valid ${data.sessions.valid} / invalid ${data.sessions.invalid}`,
    },
    {
      label:
        "Qualified",
      value:
        String(
          data.evidence.qualified,
        ),
      sub:
        data.thresholds.minQualified === null
          ? "threshold -"
          : `target ${data.thresholds.minQualified}`,
    },
    {
      label:
        "Fill Rate",
      value:
        pct(
          data.evidence.fillRate,
        ),
      sub:
        data.thresholds.minFillRate === null
          ? "threshold -"
          : `target ${pct(data.thresholds.minFillRate)}`,
    },
    {
      label:
        "Next Maturity",
      value:
        data.sessions.nextMaturityDate ??
        "-",
      sub:
        "KRX trading-session basis",
    },
  ];

  const finalChecks = [
    [
      "Qualified ≥ 80",
      data.finalGate
        .qualifiedAtLeast80,
    ],
    [
      "Calendar Days ≥ 60",
      data.finalGate
        .calendarDaysAtLeast60,
    ],
    [
      "Fill Rate ≥ 90%",
      data.finalGate
        .fillRateAtLeast90Pct,
    ],
    [
      "Paired Positive 1D",
      data.finalGate
        .pairedPositiveR1,
    ],
    [
      "Paired Positive 3D",
      data.finalGate
        .pairedPositiveR3,
    ],
    [
      "Paired Positive 5D",
      data.finalGate
        .pairedPositiveR5,
    ],
  ] as const;

  return (
    <main
      style={{
        minHeight:
          "100vh",

        padding:
          "32px",

        background:
          "#f5f7fb",

        color:
          "#172033",

        fontFamily:
          "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth:
            "1280px",

          margin:
            "0 auto",
        }}
      >
        <div
          style={{
            display:
              "flex",

            justifyContent:
              "space-between",

            alignItems:
              "flex-start",

            gap:
              "16px",

            marginBottom:
              "24px",
          }}
        >
          <div>
            <div
              style={{
                fontSize:
                  "13px",

                fontWeight:
                  700,

                letterSpacing:
                  "0.08em",

                color:
                  "#5f6b7c",

                marginBottom:
                  "8px",
              }}
            >
              AI STOCK LAB · READ ONLY
            </div>

            <h1
              style={{
                margin:
                  0,

                fontSize:
                  "32px",
              }}
            >
              Forward OOS Observability
            </h1>

            <p
              style={{
                margin:
                  "8px 0 0",

                color:
                  "#667085",
              }}
            >
              실제 미래 데이터 축적, maturity, evaluator gate를 한 화면에서 확인합니다.
            </p>
          </div>

          <a
            href="/"
            style={{
              textDecoration:
                "none",

              padding:
                "10px 14px",

              border:
                "1px solid #d7dce5",

              borderRadius:
                "10px",

              background:
                "#ffffff",

              color:
                "#172033",

              fontWeight:
                700,
            }}
          >
            ← Main
          </a>
        </div>

        <section
          style={{
            background:
              "#ffffff",

            border:
              "1px solid #e3e7ef",

            borderRadius:
              "16px",

            padding:
              "20px",

            marginBottom:
              "18px",
          }}
        >
          <div
            style={{
              fontSize:
                "12px",

              color:
                "#667085",

              marginBottom:
                "6px",
            }}
          >
            CURRENT GATE
          </div>

          <div
            style={{
              fontSize:
                "22px",

              fontWeight:
                800,
            }}
          >
            {data.currentGate}
          </div>

          <div
            style={{
              marginTop:
                "8px",

              color:
                "#667085",
            }}
          >
            Next: {data.nextAction ?? "-"}
          </div>
        </section>

        <section
          style={{
            display:
              "grid",

            gridTemplateColumns:
              "repeat(auto-fit, minmax(210px, 1fr))",

            gap:
              "14px",

            marginBottom:
              "18px",
          }}
        >
          {cards.map(
            card => (
              <div
                key={
                  card.label
                }
                style={{
                  background:
                    "#ffffff",

                  border:
                    "1px solid #e3e7ef",

                  borderRadius:
                    "16px",

                  padding:
                    "18px",
                }}
              >
                <div
                  style={{
                    color:
                      "#667085",

                    fontSize:
                      "13px",
                  }}
                >
                  {card.label}
                </div>

                <div
                  style={{
                    fontSize:
                      "28px",

                    fontWeight:
                      800,

                    marginTop:
                      "8px",
                  }}
                >
                  {card.value}
                </div>

                <div
                  style={{
                    color:
                      "#8a94a6",

                    fontSize:
                      "12px",

                    marginTop:
                      "8px",
                  }}
                >
                  {card.sub}
                </div>
              </div>
            ),
          )}
        </section>

        <section
          style={{
            display:
              "grid",

            gridTemplateColumns:
              "repeat(auto-fit, minmax(360px, 1fr))",

            gap:
              "18px",

            marginBottom:
              "18px",
          }}
        >
          <div
            style={{
              background:
                "#ffffff",

              border:
                "1px solid #e3e7ef",

              borderRadius:
                "16px",

              padding:
                "20px",
            }}
          >
            <h2
              style={{
                margin:
                  "0 0 16px",

                fontSize:
                  "18px",
              }}
            >
              Maturity
            </h2>

            {(
              [
                "1D",
                "3D",
                "5D",
              ] as const
            ).map(
              horizon => (
                <div
                  key={
                    horizon
                  }
                  style={{
                    display:
                      "flex",

                    justifyContent:
                      "space-between",

                    padding:
                      "12px 0",

                    borderBottom:
                      "1px solid #eef1f5",
                  }}
                >
                  <span>
                    {horizon}
                  </span>

                  <strong>
                    {data.maturity[horizon]}
                  </strong>
                </div>
              ),
            )}
          </div>

          <div
            style={{
              background:
                "#ffffff",

              border:
                "1px solid #e3e7ef",

              borderRadius:
                "16px",

              padding:
                "20px",
            }}
          >
            <h2
              style={{
                margin:
                  "0 0 16px",

                fontSize:
                  "18px",
              }}
            >
              Paired Positive Rate
            </h2>

            {(
              [
                "1D",
                "3D",
                "5D",
              ] as const
            ).map(
              horizon => (
                <div
                  key={
                    horizon
                  }
                  style={{
                    display:
                      "flex",

                    justifyContent:
                      "space-between",

                    padding:
                      "12px 0",

                    borderBottom:
                      "1px solid #eef1f5",
                  }}
                >
                  <span>
                    {horizon}
                  </span>

                  <strong>
                    {pct(
                      data
                        .evidence
                        .pairedPositiveRate[
                          horizon
                        ],
                    )}
                  </strong>
                </div>
              ),
            )}
          </div>
        </section>

        <section
          style={{
            background:
              "#ffffff",

            border:
              "1px solid #e3e7ef",

            borderRadius:
              "16px",

            padding:
              "20px",

            marginBottom:
              "18px",
          }}
        >
          <h2
            style={{
              margin:
                "0 0 16px",

              fontSize:
                "18px",
            }}
          >
            Final Gate
          </h2>

          <div
            style={{
              display:
                "grid",

              gridTemplateColumns:
                "repeat(auto-fit, minmax(220px, 1fr))",

              gap:
                "10px",
            }}
          >
            {finalChecks.map(
              ([
                label,
                value,
              ]) => (
                <div
                  key={
                    label
                  }
                  style={{
                    display:
                      "flex",

                    justifyContent:
                      "space-between",

                    border:
                      "1px solid #eef1f5",

                    borderRadius:
                      "10px",

                    padding:
                      "12px",
                  }}
                >
                  <span>
                    {label}
                  </span>

                  <strong
                    style={{
                      color:
                        tone(
                          value,
                        ),
                    }}
                  >
                    {yesNo(
                      value,
                    )}
                  </strong>
                </div>
              ),
            )}
          </div>

          <div
            style={{
              marginTop:
                "16px",

              padding:
                "12px",

              borderRadius:
                "10px",

              background:
                data
                  .finalGate
                  .trueForwardReady
                  ? "#eaf7ef"
                  : "#fff8e1",

              color:
                data
                  .finalGate
                  .trueForwardReady
                  ? "#157347"
                  : "#8a6200",

              fontWeight:
                800,
            }}
          >
            TRUE FORWARD READY:{" "}
            {data
              .finalGate
              .trueForwardReady
              ? "YES"
              : "NO"}
          </div>
        </section>

        <section
          style={{
            display:
              "grid",

            gridTemplateColumns:
              "repeat(auto-fit, minmax(360px, 1fr))",

            gap:
              "18px",
          }}
        >
          <div
            style={{
              background:
                "#ffffff",

              border:
                "1px solid #e3e7ef",

              borderRadius:
                "16px",

              padding:
                "20px",
            }}
          >
            <h2
              style={{
                margin:
                  "0 0 12px",

                fontSize:
                  "18px",
              }}
            >
              Data Quality
            </h2>

            {data.warnings.length ===
            0 ? (
              <div
                style={{
                  color:
                    "#157347",
                }}
              >
                경고 없음
              </div>
            ) : (
              <ul
                style={{
                  margin:
                    0,

                  paddingLeft:
                    "20px",

                  color:
                    "#8a6200",
                }}
              >
                {data.warnings.map(
                  warning => (
                    <li
                      key={
                        warning
                      }
                      style={{
                        marginBottom:
                          "8px",
                      }}
                    >
                      {warning}
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>

          <div
            style={{
              background:
                "#ffffff",

              border:
                "1px solid #e3e7ef",

              borderRadius:
                "16px",

              padding:
                "20px",
            }}
          >
            <h2
              style={{
                margin:
                  "0 0 12px",

                fontSize:
                  "18px",
              }}
            >
              Producer Evidence
            </h2>

            <div>
              Status:{" "}
              <strong>
                {data
                  .producerEvidence
                  .status ??
                "-"}
              </strong>
            </div>

            <div
              style={{
                marginTop:
                  "8px",
              }}
            >
              Mode:{" "}
              <strong>
                {data
                  .producerEvidence
                  .mode ??
                "-"}
              </strong>
            </div>

            <div
              style={{
                marginTop:
                  "8px",
              }}
            >
              Session delta:{" "}
              <strong>
                {data
                  .producerEvidence
                  .sessionDelta}
              </strong>
            </div>

            <div
              style={{
                marginTop:
                  "8px",
              }}
            >
              Normal producer executed:{" "}
              <strong>
                {data
                  .producerEvidence
                  .normalProducerExecuted
                  ? "YES"
                  : "NO"}
              </strong>
            </div>
          </div>
        </section>

        <div
          style={{
            marginTop:
              "18px",

            color:
              "#8a94a6",

            fontSize:
              "12px",
          }}
        >
          Generated {data.generatedAt} · Read-only dashboard · No order / position / promotion mutation
        </div>
      </div>
    </main>
  );
}
