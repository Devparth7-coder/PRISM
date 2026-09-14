import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth";
import { db } from "../db/client";

export const membersRouter = Router();

interface MemberView {
  id: string;
  role: string;
  joinedAt: string;
  email: string;
}

const ROLES = ["admin", "member"] as const;

const createMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES).default("member"),
});

const updateMemberSchema = z.object({
  role: z.enum(ROLES),
});

/** Explicit response DTO — credential columns never cross the API boundary. */
function toMemberView(row: Record<string, unknown>): MemberView {
  return {
    id: String(row.id),
    role: String(row.role),
    joinedAt: String(row.joined_at),
    email: String(row.email),
  };
}

// List members of an organization (single bounded query).
membersRouter.get(
  "/api/orgs/:orgId/members",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const orgId = req.params.orgId as string;
    const limit = Math.min(Number(req.query.limit ?? 50), 100);

    const members = await db.query(
      `SELECT m.id, m.role, m.joined_at, u.email
         FROM members m
         JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1
        ORDER BY m.joined_at DESC
        LIMIT $2`,
      [orgId, limit],
    );

    res.json({ members: members.map(toMemberView) });
  },
);

// Add a member to an organization (admin only, validated + parameterized).
membersRouter.post(
  "/api/orgs/:orgId/members",
  requireAuth,
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const orgId = req.params.orgId as string;
    const parsed = createMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
      return;
    }
    const { userId, role } = parsed.data;

    // Parameterized duplicate check.
    const existing = await db.query("SELECT id FROM members WHERE org_id = $1 AND user_id = $2", [
      orgId,
      userId,
    ]);
    if (existing.length > 0) {
      res.status(409).json({ error: "user is already a member of this organization" });
      return;
    }

    const [membership] = await db.query(
      "INSERT INTO members (org_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4) RETURNING id, role",
      [orgId, userId, role, req.user!.id],
    );
    res.status(201).json({ member: membership });
  },
);

// Update an existing member's role.
membersRouter.patch(
  "/api/orgs/:orgId/members/:userId",
  requireAuth,
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const orgId = req.params.orgId as string;
    const targetUser = req.params.userId;
    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
      return;
    }

    const [member] = await db.query(
      "SELECT id, role FROM members WHERE org_id = $1 AND user_id = $2",
      [orgId, targetUser],
    );
    if (!member) {
      res.status(404).json({ error: "membership not found" });
      return;
    }

    const [updated] = await db.query(
      "UPDATE members SET role = $1 WHERE org_id = $2 AND user_id = $3 RETURNING id, role",
      [parsed.data.role, orgId, targetUser],
    );
    res.json({ member: updated });
  },
);
