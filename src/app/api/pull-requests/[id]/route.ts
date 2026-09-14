import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prDetail } from "@/lib/services/read-models";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireUser();
    return NextResponse.json(prDetail(params.id, user.id));
  } catch (err) {
    return apiError(err);
  }
}
