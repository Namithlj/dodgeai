const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
require("dotenv").config();

const ingestRoutes = require("./routes/ingest");
const graphRoutes = require("./routes/graph");
const queryRoutes = require("./routes/query");
const seedRoutes = require("./routes/seed");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/ingest", ingestRoutes);
app.use("/graph", graphRoutes);
app.use("/query", queryRoutes);
app.use("/seed", seedRoutes);

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});

