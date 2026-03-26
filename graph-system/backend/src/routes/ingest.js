const express = require("express");

const { ingestGraph } = require("../services/neo4j/ingestGraph");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const reset = req.body?.reset !== false;
    const entities = Array.isArray(req.body?.entities) ? req.body.entities : undefined;
    const stats = await ingestGraph({
      reset,
      entities,
      onStep: ({ event, step, result }) => {
        // Keep logs on the backend terminal for “step-by-step” ingestion.
        if (event === "start") console.log(`[ingest] starting: ${step}`);
        if (event === "done") console.log(`[ingest] done: ${step} -> ${JSON.stringify(result)}`);
      },
    });
    return res.json({ ok: true, stats });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

module.exports = router;

