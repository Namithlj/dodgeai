# DodgeAI (Graph + Conversational Query)

This repository contains a graph-based O2C (Order-to-Cash) dataset explorer + LLM-grounded conversational query system using Neo4j, Express backend, and a React/Vite frontend.

## ✅ What is included

- `sap-o2c-data/`: JSONL data partitions for ingestion.
- `graph-system/backend`: Node.js + Express API and ingestion pipeline into Neo4j.
- `graph-system/frontend`: Vite + React UI with graph visualization and chat.

## 🔧 Status after fix steps

- `.gitignore` set:
  - `node_modules/`, `.env`, `.DS_Store`, `coverage/`, `build/`
- Repository on `main` branch.
- Remote `origin` configured as `https://github.com/Namithlj/dodgeai.git`.
- Initial commit on `main` pushed successfully.

## 🧪 Run locally (development)

### 1) Neo4j

Use Docker or local install.

```bash
cd graph-system
docker compose up -d neo4j
```

Default (or in `backend/.env`):
- `NEO4J_URI=neo4j://localhost:7687`
- `NEO4J_USER=neo4j`
- `NEO4J_PASSWORD=neo4j-pass-graph-system`

### 2) Backend

```bash
cd graph-system/backend
npm install
cp .env.example .env
# adjust as needed
npm run start
```

Ingest data:

```bash
curl -X POST http://localhost:4000/ingest -H "Content-Type: application/json" -d '{"reset": true}'
```

### 3) Frontend

```bash
cd graph-system/frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## 🚀 Deploy to Render (recommended configuration)

Use 2 services: backend + frontend.

### A) Backend service (Node)
- GitHub repo: `Namithlj/dodgeai`
- Root directory: `graph-system/backend`
- Environment:
  - `PORT=10000` (Render default or as configured)
  - `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`
  - `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` (if using openrouter/groq)
  - `DATA_ROOT=/opt/render/project/src/sap-o2c-data` (optional check path)
- Build command: `npm install`
- Start command: `npm start`
- Health check: `http://<backend-url>/health`

### B) Frontend service (Static/Vite)
- Root directory: `graph-system/frontend`
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Environment:
  - `VITE_BACKEND_URL=https://<backend-url>`

If using a single service (monorepo) with custom Dockerfile, ensure both backend and frontend are built and served with a reverse proxy.

## 📦 Important notes

- `node_modules` is ignored in git and should not be pushed.
- `graph-system/backend/src/config.js` reads `.env` and defaults for Neo4j and LLM.
- frontend defaults to `http://localhost:4000` unless `VITE_BACKEND_URL` is set.

## 🔍 Next steps for Render auto deploy

1. Log in to Render, create new service(s), connect GitHub repo.
2. Set environment variables and secrets.
3. Deploy backend first, then frontend.
4. Verify:
   - `GET <backend>/health` returns `{ "ok": true }`
   - Chat works in frontend, graph loads.

## 🧩 Existing detailed architecture docs

See `graph-system/README.md` for core architecture, API routes, graph model, and usage examples.
