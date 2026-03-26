function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function sanitizeNeo4jProps(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;

  // neo4j-driver only accepts scalar properties. Store objects/arrays as JSON.
  if (Array.isArray(value) || isPlainObject(value)) return JSON.stringify(value);
  return String(value);
}

function sanitizePropsObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const safe = sanitizeNeo4jProps(v);
    if (safe !== undefined) out[k] = safe;
  }
  return out;
}

function normalizeItemId(itemId) {
  if (itemId === null || itemId === undefined) return "";
  const s = String(itemId).trim();
  if (!s) return "";
  // Remove leading zeros for matching between "10" and "000010".
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return s;
  return String(n);
}

module.exports = { sanitizePropsObject, normalizeItemId };

