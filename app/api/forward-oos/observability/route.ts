import {
  NextResponse,
} from "next/server";

import {
  getForwardOosObservabilityDashboardV1,
} from "@/lib/research/get-forward-oos-observability-dashboard-v1";

export const dynamic =
  "force-dynamic";

export async function GET() {
  const dashboard =
    getForwardOosObservabilityDashboardV1();

  return NextResponse.json(
    dashboard,
    {
      headers: {
        "Cache-Control":
          "no-store",
      },
    },
  );
}
