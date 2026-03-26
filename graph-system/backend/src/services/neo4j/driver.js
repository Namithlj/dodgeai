const neo4j = require("neo4j-driver");
const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } = require("../../config");

let driver;

function getDriver() {
  if (driver) return driver;
  driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD), {
    // Avoid long default timeouts during ingestion
    maxTransactionRetryTime: 60_000,
  });
  return driver;
}

async function closeDriver() {
  if (!driver) return;
  await driver.close();
  driver = undefined;
}

module.exports = { getDriver, closeDriver };

