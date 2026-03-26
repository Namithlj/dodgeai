const { getDriver } = require("./driver");
const neo4j = require("neo4j-driver");

const MAX_GRAPH_NODES_DEFAULT = 250;

function normalizeLabel(label) {
  // Prevent arbitrary label injection. Allow only known labels.
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
  return allowed.has(label) ? label : null;
}

function toNode(n) {
  return {
    id: n.properties.id,
    label: n.labels[0] || "Unknown",
    properties: n.properties,
  };
}

function toEdge(r) {
  return {
    type: r.type,
    properties: r.properties,
    source: r.startNodeElementId,
    target: r.endNodeElementId,
  };
}

async function getSubgraph({ label, id, limit = MAX_GRAPH_NODES_DEFAULT } = {}) {
  const safeLabel = normalizeLabel(label);
  if (!safeLabel) throw new Error(`Invalid label: ${label}`);
  const safeLimit = Math.max(10, Math.floor(Number(limit)));
  const driver = getDriver();
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    // Depth>1 can get expensive quickly; for now we keep it simple (neighbors only).
    const cypher = `
      MATCH (n:${safeLabel} {id: $id})
      OPTIONAL MATCH (n)-[r]-(m)
      WITH n, r, m
      LIMIT $limit
      RETURN n, r, m
    `;
    const result = await session.run(cypher, { id, limit: neo4j.int(safeLimit) });

    const nodeMap = new Map(); // key: label|id
    const edges = [];

    for (const record of result.records) {
      const n = record.get("n");
      const r = record.get("r");
      const m = record.get("m");

      if (n) {
        const nn = toNode(n);
        nodeMap.set(`${nn.label}|${nn.id}`, nn);
      }
      if (m) {
        const mm = toNode(m);
        nodeMap.set(`${mm.label}|${mm.id}`, mm);
      }
      if (r && n && m) {
        edges.push({
          source: `${n.labels[0]}|${n.properties.id}`,
          target: `${m.labels[0]}|${m.properties.id}`,
          type: r.type,
          properties: r.properties,
        });
      }
    }

    return { nodes: Array.from(nodeMap.values()).slice(0, safeLimit), edges };
  } finally {
    await session.close();
  }
}

module.exports = { getSubgraph };

