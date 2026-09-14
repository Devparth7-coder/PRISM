import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-change-me";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; login: string; role: string };
}

/**
 * Shared authentication guard. Every non-public API route in this service
 * applies `requireAuth` before its handler.
 */
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ["HS256"] }) as {
      sub: string;
      login: string;
      role: string;
    };
    req.user = { id: payload.sub, login: payload.login, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}

/** Role guard. Must be mounted after requireAuth. */
export function requireRole(role: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: `requires role ${role}` });
      return;
    }
    next();
  };
}
