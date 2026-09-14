import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth";
import { db } from "../db/client";

export const organizationsRouter = Router();

const createOrgSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9-]+$/),
});

// List organizations visible to the caller.
organizationsRouter.get("/api/orgs", requireAuth, async (req: AuthenticatedRequest, res) => {
  const orgs = await db.query(
    `SELECT o.id, o.name, o.slug
       FROM organizations o
       JOIN memberships m ON m.org_id = o.id
      WHERE m.user_id = $1`,
    [req.user!.id],
  );
  res.json({ organizations: orgs });
});

// Create an organization (admin only), with validated request body.
organizationsRouter.post(
  "/api/orgs",
  requireAuth,
  requireRole("admin"),
  async (req: AuthenticatedRequest, res) => {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
      return;
    }
    const [org] = await db.query(
      `INSERT INTO organizations (name, slug, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug`,
      [parsed.data.name, parsed.data.slug, req.user!.id],
    );
    res.status(201).json({ organization: org });
  },
);

// Fetch a single organization the caller belongs to.
organizationsRouter.get("/api/orgs/:orgId", requireAuth, async (req: AuthenticatedRequest, res) => {
  const [org] = await db.query(
    `SELECT o.id, o.name, o.slug
       FROM organizations o
       JOIN memberships m ON m.org_id = o.id
      WHERE o.id = $1 AND m.user_id = $2`,
    [req.params.orgId, req.user!.id],
  );
  if (!org) {
    res.status(404).json({ error: "organization not found" });
    return;
  }
  res.json({ organization: org });
});
