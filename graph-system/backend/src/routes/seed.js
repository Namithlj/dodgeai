const express = require("express");
const neo4j = require("neo4j-driver");

const { getDriver } = require("../services/neo4j/driver");

const router = express.Router();

function normalizeLabel(label) {
  const allowed = new Set([
    "SalesOrder",
    "SalesOrderItem",
    "Delivery",
    "DeliveryItem",
    "BillingDocument",
    "BillingItem",
    "JournalEntry",
    "Payment",
    "Customer",
    "Product",
    "Plant",
    "Address",
  ]);
  if (!label) return null;
  return allowed.has(label) ? label : null;
}

router.get("/", async (req, res) => {
  try {
    const label = normalizeLabel(req.query.label ? String(req.query.label) : "");
    if (!label) return res.status(400).json({ error: "Missing/invalid label" });

    const idField = "id";
    const session = getDriver().session({ defaultAccessMode: "READ" });
    try {
      const cypher = `MATCH (n:${label}) RETURN n.${idField} AS id LIMIT 1`;
      const result = await session.run(cypher);
      const record = result.records[0];
      const id = record?.get("id");
      if (!id) return res.status(404).json({ error: "No nodes found for label" });
      return res.json({ label, id: String(id) });
    } finally {
      await session.close();
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;

