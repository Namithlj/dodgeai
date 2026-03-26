const { getLlmClientConfig } = require("../../config");
const { SYSTEM_PROMPT } = require("./prompt");

function safeExtractJson(text) {
  if (!text) throw new Error("Empty LLM response");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`LLM response did not contain JSON. Response: ${text.slice(0, 200)}`);
  }
  return text.slice(first, last + 1);
}

async function getStructuredQuery(question) {
  const cfg = getLlmClientConfig();
  if (!cfg) {
    // Safe fallback: we cannot translate/execute grounded answers without the LLM.
    // Guardrail: reject unrelated or untranslatable prompts rather than erroring.
    const q = String(question || "").toLowerCase();

    // Simple keyword-based intent detection for the three supported intents.
    if (/(top|highest|most)\b/.test(q) && q.includes("product") && q.includes("billing")) {
      const topK = q.match(/\btop\s*(\d+)/)?.[1] ? Number(q.match(/\btop\s*(\d+)/)[1]) : 5;
      return { intent: "top_products_by_billing", params: { topK } };
    }

    if ((q.includes("trace") || q.includes("flow")) && q.includes("billing document")) {
      const m = q.match(/billing document\s*(\d+)/) || q.match(/billing doc(?:ument)?\s*(\d+)/);
      const billingDocumentId = m?.[1] ? String(m[1]) : "";
      if (billingDocumentId) return { intent: "trace_billing_document", params: { billingDocumentId } };
    }

    if ((q.includes("broken") || q.includes("incomplete") || q.includes("missing")) && q.includes("flow")) {
      const limit = q.match(/\blimit\s*(\d+)/)?.[1] ? Number(q.match(/\blimit\s*(\d+)/)[1]) : 20;
      return { intent: "find_broken_flows", params: { limit } };
    }

    return { intent: "reject", params: {} };
  }

  const { LLM_PROVIDER, LLM_API_KEY, LLM_MODEL } = cfg;

  let url;
  let headers = {};
  if (LLM_PROVIDER === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${LLM_API_KEY}`,
      "HTTP-Referer": "http://localhost",
      "X-Title": "Graph Conversational Query System",
    };
  } else if (LLM_PROVIDER === "groq") {
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers = { Authorization: `Bearer ${LLM_API_KEY}` };
  } else {
    throw new Error(`Unsupported LLM_PROVIDER: ${LLM_PROVIDER}`);
  }

  const body = {
    model: LLM_MODEL,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `User question: ${question}\nReturn ONLY the JSON.` },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM request failed: ${res.status} ${t.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
  const jsonText = safeExtractJson(content);
  return JSON.parse(jsonText);
}

module.exports = { getStructuredQuery };

