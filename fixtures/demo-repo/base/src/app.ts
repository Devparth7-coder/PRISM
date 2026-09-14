import express from "express";
import { organizationsRouter } from "./routes/organizations";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use(organizationsRouter);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`atlas-org-service listening on :${port}`);
});

export { app };
