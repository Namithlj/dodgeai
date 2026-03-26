const express = require("express");
const { getSubgraph } = require("../services/neo4j/graphRead");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const label = req.query.label;
    const id = req.query.id;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    if (!label || !id) {
      return res.status(400).json({ error: "Missing required query params: label, id" });
    }
    const graph = await getSubgraph({ label, id, limit });
    return res.json(graph);
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;

