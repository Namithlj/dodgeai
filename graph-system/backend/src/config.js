const path = require("path");

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const DATA_ROOT = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.resolve(__dirname, "..", "..", "..", "sap-o2c-data");

const NEO4J_URI = process.env.NEO4J_URI || "neo4j://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER || "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "neo4j-pass-graph-system";

// LLM provider config (free-tier friendly defaults).
const LLM_PROVIDER = process.env.LLM_PROVIDER || "openrouter"; // openrouter | groq
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "meta-llama/llama-3.1-70b-instruct";

function getLlmClientConfig() {
  if (!LLM_API_KEY) return null;
  return { LLM_PROVIDER, LLM_API_KEY, LLM_MODEL };
}

module.exports = {
  DATA_ROOT,
  NEO4J_URI,
  NEO4J_USER,
  NEO4J_PASSWORD,
  getLlmClientConfig,
  required,
};

