const express = require("express");
const { z } = require("zod");

const { getStructuredQuery } = require("../services/llm/llmClient");
const { executeStructuredQuery } = require("../services/query/executeQuery");

const router = express.Router();

const StructuredQuerySchema = z.object({
  intent: z.enum(["top_products_by_billing", "trace_billing_document", "find_broken_flows", "reject"]),
  // We don't strongly type params here; execution layer validates required fields per intent.
  // Using a permissive schema avoids Zod v4 record-value typing issues.
  params: z.any().optional(),
});

router.post("/", async (req, res) => {
  try {
    const question = req.body?.question;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Missing required field: question" });
    }

    const structured = await getStructuredQuery(question);
    const parsed = StructuredQuerySchema.safeParse(structured);
    if (!parsed.success) {
      return res.status(400).json({ error: "LLM returned an invalid query plan", details: parsed.error?.message });
    }

    if (parsed.data.intent === "reject") {
      const answer = "This system is designed to answer questions related to the dataset only.";
      return res.json({ answer, intent: parsed.data.intent, generatedQuery: parsed.data });
    }

    const execution = await executeStructuredQuery(parsed.data);
    return res.json({
      answer: execution.answer,
      intent: parsed.data.intent,
      generatedQuery: parsed.data,
      result: execution,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    const status = msg.toLowerCase().includes("missing") ? 400 : 500;
    return res.status(status).json({ error: msg });
  }
});

module.exports = router;

