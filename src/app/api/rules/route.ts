import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { addRule, listRules, setRuleEnabled } from "@/lib/db/repo/governance";
import { authorizedRepoIds } from "@/lib/db/repo/identity";
import { z } from "zod";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ruleSchema = z.object({
  repositoryId: z.string(),
  kind: z.enum(["block", "require", "allow", "custom"]),
  pattern: z.string().min(2).max(400),
  description: z.string().min(4).max(400),
  rationale: z.string().max(600).optional(),
  pathGlob: z.string().max(200).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = requireUser();
    const repoId = req.nextUrl.searchParams.get("repositoryId");
    if (!repoId) return NextResponse.json({ error: "repositoryId required" }, { status: 400 });
    if (!authorizedRepoIds(user.id).has(repoId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ rules: listRules(repoId) });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireUser();
    const body = ruleSchema.parse(await req.json());
    if (!authorizedRepoIds(user.id).has(body.repositoryId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rule = addRule(body);
    return NextResponse.json({ ok: true, rule });
  } catch (err) {
    return apiError(err);
  }
}

const toggleSchema = z.object({ ruleId: z.string(), enabled: z.boolean() });

export async function PATCH(req: NextRequest) {
  try {
    const user = requireUser();
    const body = toggleSchema.parse(await req.json());
    // Rules repo scoping check: fetch rule -> repository membership.
    const { db } = await import("@/lib/db/client");
    const row = db().prepare("SELECT repository_id FROM repository_rules WHERE id=?").get(body.ruleId) as
      | { repository_id: string }
      | undefined;
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!authorizedRepoIds(user.id).has(row.repository_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    setRuleEnabled(body.ruleId, body.enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
