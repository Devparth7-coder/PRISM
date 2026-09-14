# atlas-org-service

Organization and membership service for the Atlas internal platform.

- Express + TypeScript API
- PostgreSQL data layer (`src/db`)
- Shared authentication middleware (`src/middleware/auth.ts`)
- Routes must apply `requireAuth` and, for admin operations, `requireRole`
