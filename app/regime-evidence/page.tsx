import {
  getRegimeForwardEvidenceV75,
} from "@/lib/market/get-regime-forward-evidence-v7-5";

export const dynamic =
  "force-dynamic";

function pct(
  value:
    | number
    | null,
) {
  if (
    value === null
  ) {
    return "-";
  }

  return `${(
    value *
    100
  ).toFixed(2)}%`;
}

function num(
  value:
    | number
    | null,
  digits = 3,
) {
  if (
    value === null
  ) {
    return "-";
  }

  return value.toFixed(
    digits,
  );
}

const cardStyle = {
  border:
    "1px solid rgba(127,127,127,0.25)",
  borderRadius:
    "12px",
  padding:
    "16px",
};

const tableStyle = {
  width:
    "100%",
  borderCollapse:
    "collapse" as const,
};

const cellStyle = {
  borderBottom:
    "1px solid rgba(127,127,127,0.20)",
  padding:
    "10px 8px",
  textAlign:
    "left" as const,
  verticalAlign:
    "top" as const,
};

export default async function RegimeEvidencePage() {
  const evidence =
    await getRegimeForwardEvidenceV75();

  const agreementEntries =
    Object.entries(
      evidence.byAgreement,
    );

  return (
    <main
      style={{
        maxWidth: 1200,
        margin:
          "0 auto",
        padding:
          "24px",
        display:
          "grid",
        gap:
          "18px",
      }}
    >
      <div>
        <h1
          style={{
            marginBottom:
              "6px",
          }}
        >
          Market Regime v7.5 Forward Evidence
        </h1>

        <div>
          Stage:{" "}
          <strong>
            {
              evidence.evidenceStage
            }
          </strong>
          {" · "}
          Production applied:{" "}
          <strong>
            NO
          </strong>
        </div>
      </div>

      <section
        style={{
          display:
            "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(190px, 1fr))",
          gap:
            "12px",
        }}
      >
        <div
          style={
            cardStyle
          }
        >
          <div>
            Total outcomes
          </div>
          <strong>
            {
              evidence.sample
                .totalOutcomeRows
            }
          </strong>
        </div>

        <div
          style={
            cardStyle
          }
        >
          <div>
            Completed
          </div>
          <strong>
            {
              evidence.sample
                .completed
            }
          </strong>
        </div>

        <div
          style={
            cardStyle
          }
        >
          <div>
            Pending
          </div>
          <strong>
            {
              evidence.sample
                .pending
            }
          </strong>
        </div>

        <div
          style={
            cardStyle
          }
        >
          <div>
            Direct disagreements
          </div>
          <strong>
            {
              evidence.sample
                .disagreementCompleted
            }
          </strong>
        </div>
      </section>

      <section
        style={{
          display:
            "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(280px, 1fr))",
          gap:
            "12px",
        }}
      >
        <div
          style={
            cardStyle
          }
        >
          <h2>
            v6
          </h2>

          <div>
            Sample:{" "}
            {
              evidence.v6
                .sampleSize
            }
          </div>

          <div>
            Correct rate:{" "}
            {
              pct(
                evidence.v6
                  .correctRate,
              )
            }
          </div>

          <div>
            Avg decision score:{" "}
            {
              num(
                evidence.v6
                  .averageScore,
                5,
              )
            }
          </div>
        </div>

        <div
          style={
            cardStyle
          }
        >
          <h2>
            v7
          </h2>

          <div>
            Sample:{" "}
            {
              evidence.v7
                .sampleSize
            }
          </div>

          <div>
            Correct rate:{" "}
            {
              pct(
                evidence.v7
                  .correctRate,
              )
            }
          </div>

          <div>
            Avg decision score:{" "}
            {
              num(
                evidence.v7
                  .averageScore,
                5,
              )
            }
          </div>
        </div>

        <div
          style={
            cardStyle
          }
        >
          <h2>
            Head-to-head
          </h2>

          <div>
            Sample:{" "}
            {
              evidence.headToHead
                .sampleSize
            }
          </div>

          <div>
            v6 wins:{" "}
            {
              evidence.headToHead
                .v6Wins
            }
          </div>

          <div>
            v7 wins:{" "}
            {
              evidence.headToHead
                .v7Wins
            }
          </div>

          <div>
            ties:{" "}
            {
              evidence.headToHead
                .ties
            }
          </div>
        </div>
      </section>

      <section
        style={
          cardStyle
        }
      >
        <h2>
          Agreement-state evidence
        </h2>

        <div
          style={{
            overflowX:
              "auto",
          }}
        >
          <table
            style={
              tableStyle
            }
          >
            <thead>
              <tr>
                <th
                  style={
                    cellStyle
                  }
                >
                  State
                </th>
                <th
                  style={
                    cellStyle
                  }
                >
                  Total
                </th>
                <th
                  style={
                    cellStyle
                  }
                >
                  Completed
                </th>
                <th
                  style={
                    cellStyle
                  }
                >
                  Avg 1D
                </th>
                <th
                  style={
                    cellStyle
                  }
                >
                  Avg 3D
                </th>
                <th
                  style={
                    cellStyle
                  }
                >
                  Avg 5D
                </th>
                <th
                  style={
                    cellStyle
                  }
                >
                  5D positive
                </th>
              </tr>
            </thead>

            <tbody>
              {
                agreementEntries.map(
                  ([
                    state,
                    value,
                  ]) => (
                    <tr
                      key={
                        state
                      }
                    >
                      <td
                        style={
                          cellStyle
                        }
                      >
                        {
                          state
                        }
                      </td>
                      <td
                        style={
                          cellStyle
                        }
                      >
                        {
                          value.total
                        }
                      </td>
                      <td
                        style={
                          cellStyle
                        }
                      >
                        {
                          value.completed
                        }
                      </td>
                      <td
                        style={
                          cellStyle
                        }
                      >
                        {
                          pct(
                            value.averageReturn1d,
                          )
                        }
                      </td>
                      <td
                        style={
                          cellStyle
                        }
                      >
                        {
                          pct(
                            value.averageReturn3d,
                          )
                        }
                      </td>
                      <td
                        style={
                          cellStyle
                        }
                      >
                        {
                          pct(
                            value.averageReturn5d,
                          )
                        }
                      </td>
                      <td
                        style={
                          cellStyle
                        }
                      >
                        {
                          pct(
                            value.positive5dRate,
                          )
                        }
                      </td>
                    </tr>
                  ),
                )
              }
            </tbody>
          </table>
        </div>
      </section>

      <section
        style={
          cardStyle
        }
      >
        <h2>
          Latest comparison
        </h2>

        <pre
          style={{
            whiteSpace:
              "pre-wrap",
            overflowWrap:
              "anywhere",
          }}
        >
          {
            JSON.stringify(
              evidence.latestComparison,
              null,
              2,
            )
          }
        </pre>
      </section>

      <section
        style={
          cardStyle
        }
      >
        <h2>
          Safety
        </h2>

        <p>
          Forward evidence is observational.
          This dashboard never changes signal qualification,
          risk validation, or production order blocking.
        </p>
      </section>
    </main>
  );
}