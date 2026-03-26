const { ingestGraph } = require("../services/neo4j/ingestGraph");

function parseArgs(argv) {
  const out = { reset: true, entities: undefined };
  for (const a of argv) {
    if (a.startsWith("--reset=")) {
      out.reset = String(a.split("=").slice(1).join("=")).toLowerCase() !== "false";
    } else if (a.startsWith("--entities=")) {
      const list = a.split("=").slice(1).join("=").trim();
      out.entities = list ? list.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }
  }
  return out;
}

async function main() {
  const { reset, entities } = parseArgs(process.argv.slice(2));

  const stats = await ingestGraph({
    reset,
    entities,
    onStep: ({ event, step, result }) => {
      if (event === "start") console.log(`[ingest] starting: ${step}`);
      if (event === "done") console.log(`[ingest] done: ${step} -> ${typeof result === "number" ? result : JSON.stringify(result)}`);
    },
  });

  console.log("[ingest] complete:", JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

