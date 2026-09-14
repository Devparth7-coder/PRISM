import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  dashboardMetrics,
  findingsByCategory,
  findingsBySeverity,
  findingsTimeline,
  reviewerEffectiveness,
  riskTrend,
} from "@/lib/db/repo/analytics";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = requireUser();
    return NextResponse.json({
      metrics: dashboardMetrics(user.id),
      bySeverity: findingsBySeverity(user.id),
      byCategory: findingsByCategory(user.id),
      timeline: findingsTimeline(user.id, 60),
      riskTrend: riskTrend(user.id, 25),
      reviewerEffectiveness: reviewerEffectiveness(user.id),
    });
  } catch (err) {
    return apiError(err);
  }
}
