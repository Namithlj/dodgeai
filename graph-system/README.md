# Graph-Based Data Modeling & Conversational Query System

This project turns the provided SAP O2C (Order-to-Cash) dataset into a Neo4j property graph, visualizes it in a React UI, and answers natural-language questions by:
1. Using an LLM to convert the question into a **restricted intent plan**
2. Executing **grounded Neo4j Cypher** for that intent
3. Returning the result as a data-backed natural-language answer

## Folder Structure

- `backend/` (Node.js + Express)
  - `/ingest` builds the Neo4j graph from `sap-o2c-data/*.jsonl`
  - `/query` accepts natural language and returns grounded answers
  - `/graph` returns a small neighborhood subgraph for the UI
- `frontend/` (Vite + React + Tailwind + react-force-graph)
  - Sidebar chat + right-side graph visualization

## Data Model (Neo4j)

### Node Labels

- `SalesOrder`, `SalesOrderItem`
- `Delivery`, `DeliveryItem`
- `BillingDocument`, `BillingItem`
- `JournalEntry`, `Payment`
- `Customer`
- `Product`
- `Plant`
- `Address`

### Relationship Highlights

- `(:SalesOrder)-[:HAS_ITEM]->(:SalesOrderItem)`
- `(:SalesOrderItem)-[:DELIVERED_IN]->(:DeliveryItem)`
- `(:Delivery)-[:HAS_ITEM]->(:DeliveryItem)`
- `(:Delivery)-[:LINKED_TO]->(:SalesOrder)`
- `(:BillingDocument)-[:GENERATED_FROM]->(:Delivery)`
- `(:BillingDocument)-[:HAS_ITEM]->(:BillingItem)`
- `(:BillingDocument)-[:POSTED_TO]->(:JournalEntry)`
- `(:JournalEntry)-[:CLEARED_BY]->(:Payment)`
- `(:Customer)-[:PLACED]->(:SalesOrder)`
- `(:Product)-[:REFERENCED_IN]->(:SalesOrderItem|:DeliveryItem|:BillingItem)`

## Backend APIs

- `GET /health`
- `POST /ingest`
  - Body: `{ "reset": true }` (default `true`)
  - Reads all required JSONL folders and rebuilds the graph.
- `GET /graph?label=BillingDocument&id=90504219&limit=250`
  - Returns nodes + edges for the clicked node’s immediate neighborhood (used for UI expansion).
- `POST /query`
  - Body: `{ "question": "..." }`
  - Response: `{ answer, intent, generatedQuery, result }`

## LLM Prompting + Guardrails

- The LLM is only used for **translation**: it must output an intent plan in strict JSON.
- The system prompt forbids answering outside the dataset and instructs the model to use only these intents:
  - `top_products_by_billing`
  - `trace_billing_document`
  - `find_broken_flows`
  - `reject`
- The server executes only hard-coded Cypher templates per intent, so the LLM cannot inject arbitrary queries.

## How to Run

### 1) Start Neo4j

Neo4j is expected at `NEO4J_URI` (default `neo4j://localhost:7687`).

Recommended (Docker):

```bash
cd graph-system
docker compose up -d neo4j
```

Default credentials are `neo4j / neo4j-pass-graph-system` (match `backend/.env.example`).

### 2) Backend

```bash
cd backend
npm i
```

Create `backend/.env` (see `backend/.env.example`).

In one terminal:

```bash
npm run start
```

In another terminal, rebuild the graph:

```bash
curl -X POST http://localhost:4000/ingest -H "Content-Type: application/json" -d "{\"reset\": true}"
```

### 3) Frontend

```bash
cd frontend
npm i
npm run dev
```

Open the printed Vite URL (default `http://localhost:5173`).

## Example Questions

- `Which products are associated with the highest number of billing documents?`
- `Trace the full flow of billing document 90504219`
- `Identify sales orders that have broken or incomplete flows`

