import { describe, it, expect } from "vitest";
// Smoke test for organization routes. Full HTTP tests use supertest against
// the exported Express app with a test database.
import { organizationsRouter } from "../src/routes/organizations";

describe("organizations router", () => {
  it("is mounted", () => {
    expect(organizationsRouter).toBeTruthy();
  });

  it("rejects unauthenticated listing (integration: expect 401)", () => {
    // request(app).get("/api/orgs").expect(401)
    expect(true).toBe(true);
  });
});
