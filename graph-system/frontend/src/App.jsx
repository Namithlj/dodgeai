import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

function asGraphData(apiGraph) {
  // Backend returns nodes: {id,label,properties} and edges: {source,target,type,properties}
  const nodes = (apiGraph?.nodes || []).map((n) => {
    const key = `${n.label}|${n.id}`;
    const name =
      n.properties?.name ||
      n.properties?.plantName ||
      n.properties?.productDescription ||
      n.properties?.billingDocumentType ||
      n.properties?.salesOrderType ||
      n.label;
    return {
      id: key,
      name: `${n.label}: ${name} (${n.id})`,
      label: n.label,
      // `react-force-graph` defaults to nodeVal="val". If `val` is missing it can
      // result in effectively invisible node sizing.
      val: 1,
      raw: n,
    };
  });

  const links = (apiGraph?.edges || []).map((e) => ({
    source: e.source,
    target: e.target,
    name: e.type,
    raw: e,
  }));

  return { nodes, links };
}

async function fetchSubgraph(label, id, limit = 250) {
  const url = `${BACKEND_URL}/graph?label=${encodeURIComponent(label)}&id=${encodeURIComponent(id)}&limit=${encodeURIComponent(
    limit,
  )}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Failed to fetch graph: ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function runQuery(question) {
  const res = await fetch(`${BACKEND_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Query failed: ${res.status}`);
  return data;
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [showGeneratedPlan, setShowGeneratedPlan] = useState(false);

  const [apiGraph, setApiGraph] = useState({ nodes: [], edges: [] });
  const graphData = useMemo(() => asGraphData(apiGraph), [apiGraph]);

  const [selectedNode, setSelectedNode] = useState(null);
  const [graphSize, setGraphSize] = useState({ w: 700, h: 600 });
  const [graphStatus, setGraphStatus] = useState({ nodes: 0, error: "" });

  const fgRef = useRef(null);

  const initialPromptSeeds = [
    "Which products are associated with the highest number of billing documents?",
    "Trace the full flow of billing document 90504219",
    "Identify sales orders that have broken or incomplete flows",
  ];

  useEffect(() => {
    const onResize = () => {
      const w = Math.floor(window.innerWidth * 0.68);
      const h = Math.floor(window.innerHeight - 24);
      setGraphSize({ w, h });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    // Fit view whenever the graph changes.
    fgRef.current?.zoomToFit?.(300, 40);
  }, [graphData]);

  useEffect(() => {
    if (apiGraph?.nodes?.length) {
      setTimeout(() => {
        fgRef.current?.zoomToFit?.(500, 80);
      }, 50);
    }
  }, [apiGraph?.nodes?.length]);

  useEffect(() => {
    // Load a default neighborhood so the graph isn't an empty black canvas.
    // Uses a server-side seed pick (first node id for a label).
    async function loadSeed() {
      try {
        const seedRes = await fetch(`${BACKEND_URL}/seed?label=${encodeURIComponent("SalesOrder")}`);
        if (!seedRes.ok) return;
        const seed = await seedRes.json();
        const sub = await fetchSubgraph(seed.label, seed.id);
        setApiGraph(sub);
        setGraphStatus({ nodes: sub?.nodes?.length || 0, error: "" });
      } catch (_e) {
        // If seed loading fails, keep empty graph (still usable via clicking nodes once available).
        setGraphStatus({ nodes: 0, error: `Seed load failed: ${String(_e?.message || _e)}` });
      }
    }
    loadSeed();
  }, []);

  async function maybeHighlightFromQuery(queryResponse) {
    const result = queryResponse?.result;
    const intent = queryResponse?.intent;
    if (!intent || !result) return;

    try {
      if (intent === "trace_billing_document") {
        // Show the billing doc and its immediate neighbors.
        const bdId = result.billingDocumentId;
        const sub = await fetchSubgraph("BillingDocument", bdId);
        setApiGraph(sub);
        setGraphStatus({ nodes: sub?.nodes?.length || 0, error: "" });
        return;
      }
      if (intent === "top_products_by_billing") {
        const top = result?.rows?.[0];
        if (!top?.productId) return;
        const sub = await fetchSubgraph("Product", String(top.productId));
        setApiGraph(sub);
        setGraphStatus({ nodes: sub?.nodes?.length || 0, error: "" });
        return;
      }
    } catch (_e) {
      // If highlighting fails, keep existing graph.
      setGraphStatus((s) => ({
        ...s,
        error: `Graph load failed: ${String(_e?.message || _e)}`,
      }));
    }
  }

  async function onSend() {
    const q = question.trim();
    if (!q) return;

    setQuestion("");
    setLoading(true);

    const userMsg = { role: "user", content: q, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);

    try {
      const data = await runQuery(q);
      const assistantMsg = {
        role: "assistant",
        content: data.answer,
        ts: Date.now(),
        generatedQuery: data.generatedQuery,
        intent: data.intent,
      };
      setMessages((m) => [...m, assistantMsg]);
      await maybeHighlightFromQuery(data);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: err.message || String(err), ts: Date.now() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleNodeClick(node) {
    if (!node?.raw) return;
    setSelectedNode(node.raw);

    try {
      const { label, id } = node.raw;
      if (!label || id === undefined || id === null) return;
      const sub = await fetchSubgraph(label, String(id));
      setApiGraph(sub);
      setGraphStatus({ nodes: sub?.nodes?.length || 0, error: "" });
    } catch (_e) {
      // Ignore expansion failures.
    }
  }

  return (
    <div className="h-full w-full flex bg-gray-950">
      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            width={graphSize.w}
            height={graphSize.h}
            nodeLabel="name"
            nodeAutoColorBy="label"
            nodeColor={() => "#34d399"}
            nodeVal="val"
            nodeRelSize={8}
            linkDirectionalParticles={0}
            linkLabel={(l) => l.name}
            linkColor={() => "rgba(148,163,184,0.7)"}
            linkWidth={1.5}
            linkOpacity={0.45}
            onNodeClick={(node) => handleNodeClick(node)}
            backgroundColor="#0b1220"
          />
        </div>

        <div className="absolute left-3 bottom-3 w-[360px] bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-lg p-3 text-gray-200 shadow-lg">
          <div className="text-sm font-semibold text-gray-200">Node Inspector</div>
          <div className="mt-2 text-[11px] text-gray-400">
            Graph: <span className="text-gray-200 font-semibold">{graphStatus.nodes}</span> nodes
          </div>
          {apiGraph?.nodes?.length ? (
            <div className="mt-2 text-[11px] text-gray-300">
              <div className="text-gray-500 mb-1">Sample nodes:</div>
              {apiGraph.nodes.slice(0, 5).map((n) => (
                <div key={`${n.label}:${n.id}`} className="break-all">
                  {n.label} {n.id}
                </div>
              ))}
            </div>
          ) : null}
          {graphStatus.error ? (
            <div className="mt-1 text-[11px] text-red-400 break-all">{graphStatus.error}</div>
          ) : null}
          {selectedNode ? (
            <div className="mt-2 text-xs text-gray-300">
              <div className="text-gray-200">{selectedNode.label}</div>
              <div className="text-gray-400 break-all">{selectedNode.id}</div>
              <div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">
                {JSON.stringify(selectedNode.properties, null, 2)}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-gray-500">
              Click a node to view its metadata.
            </div>
          )}
        </div>
      </div>

      <div className="w-[420px] border-l border-gray-800 bg-gray-950">
        <div className="h-full flex flex-col">
          <div className="p-4 border-b border-gray-800">
            <div className="text-lg font-bold">Graph Chat</div>
            <div className="text-xs text-gray-400">Ask about orders, deliveries, billing, payments.</div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="text-sm text-gray-500">
                Try: <span className="text-gray-300">“Trace billing document 90504219”</span>
              </div>
            ) : null}

            {messages.map((msg, idx) => (
              <div key={`${msg.ts}-${idx}`} className={msg.role === "user" ? "text-right" : "text-left"}>
                <div
                  className={
                    msg.role === "user"
                      ? "inline-block bg-blue-600/20 border border-blue-600/40 rounded-lg p-2 text-sm"
                      : "inline-block bg-gray-800/60 border border-gray-700 rounded-lg p-2 text-sm"
                  }
                >
                  <div className="text-xs text-gray-400 mb-1">{msg.role === "user" ? "You" : "System"}</div>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {showGeneratedPlan && msg.generatedQuery ? (
                    <div className="mt-2 text-[11px] text-gray-400 whitespace-pre-wrap">
                      <div className="text-gray-500">Generated plan:</div>
                      {JSON.stringify(msg.generatedQuery, null, 2)}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-gray-800">
            <div className="flex gap-2">
              <input
                className="flex-1 bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-sm outline-none focus:border-gray-600"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a dataset question..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSend();
                }}
                disabled={loading}
              />
              <button
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white rounded-md px-3 py-2 text-sm"
                onClick={onSend}
                disabled={loading}
              >
                {loading ? "Sending..." : "Send"}
              </button>
            </div>

            <label className="mt-3 flex items-center gap-2 text-[11px] text-gray-400 select-none">
              <input
                type="checkbox"
                checked={showGeneratedPlan}
                onChange={(e) => setShowGeneratedPlan(e.target.checked)}
              />
              Show generated intent plan
            </label>

            <div className="text-[11px] text-gray-500 mt-2">
              Grounding is enforced server-side: answers come from Neo4j results only.
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {initialPromptSeeds.map((p) => (
                <button
                  key={p}
                  className="text-[11px] bg-gray-800/70 border border-gray-700 hover:bg-gray-800 rounded-md px-2 py-1"
                  onClick={() => {
                    setQuestion(p);
                  }}
                  disabled={loading}
                  type="button"
                >
                  {p.length > 36 ? `${p.slice(0, 36)}...` : p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

