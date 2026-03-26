const fs = require("fs");
const readline = require("readline");

async function readJsonlFile(filePath, onRow) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      await onRow(row, lineNo);
    } catch (err) {
      // Include line info for debugging ingestion issues.
      throw new Error(`Failed to parse JSONL row at ${filePath}:${lineNo}: ${err.message}`);
    }
  }
}

module.exports = { readJsonlFile };

