const neo4j = require("neo4j-driver");
const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } = require("../../config");

let driver;

function getDriver() {
  if (driver) return driver;

  driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
    {
      maxTransactionRetryTime: 60000,
    }
  );

  return driver;
}

async function closeDriver() {
  if (!driver) return;
  await driver.close();
  driver = undefined;
}

/* 🔥 ADD THIS BLOCK BELOW */
async function testConnection() {
  try {
    const d = getDriver();
    await d.verifyConnectivity();
    console.log("✅ Connected to Neo4j");
  } catch (err) {
    console.error("❌ Neo4j connection failed:", err.message);
  }
}

/* 🔥 CALL IT ON START */
testConnection();

module.exports = { getDriver, closeDriver };