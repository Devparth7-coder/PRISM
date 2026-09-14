import "server-only";
import { cookies } from "next/headers";
import { getSessionUser, type SessionUser } from "./db/repo/identity";
import { SESSION_COOKIE } from "./auth-cookie";

export { SESSION_COOKIE };

export function currentUser(): SessionUser | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return getSessionUser(token);
}

export function requireUser(): SessionUser {
  const user = currentUser();
  if (!user) {
    throw Object.assign(new Error("Authentication required"), { status: 401, code: "UNAUTHENTICATED" });
  }
  return user;
}
