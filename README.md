# Multi-Modal RAG — SpiceVault Terminal

Local-first multi-modal RAG system with SpiceDB-style authorization. Originally built for Vercel, now runs entirely locally with Express + file-based vector storage.

## Features

- **Document Ingestion**: PDF, images (PNG/JPG), text files (max 5MB)
- **Multi-modal**: Text chunking + Gemini Vision for image descriptions
- **Vector Search**: Local cosine similarity (no external DB required)
- **Authorization**: SpiceDB-inspired policy system (Public / Sietch Secret / Imperial Classified)
- **Identities**: Paul (Fremen), Gurney (Smuggler), Harkonnen (Imperial Spy)
- **RAG Query**: Gemini 1.5 Flash with grounded context

## Quick Start

### Prerequisites

- Node.js 20+
- Google Gemini API key

### Installation

```bash
git clone <repo>
cd Multi-modal-RAG
npm install
```

### Environment

Create `.env` from example:

```bash
cp .env.example .env
# Add your GEMINI_API_KEY
```

### Development

```bash
npm run dev
# Server at http://localhost:3000
```

### Production Build

```bash
npm run build
npm start
```

## Docker

### Build & Run

```bash
npm run docker:build
npm run docker:run
```

### Docker Compose

```bash
npm run docker:compose
# Or directly:
docker-compose up -d
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ingest` | Upload & index document |
| POST | `/api/query` | RAG query with auth |
| GET | `/api/health` | Health check |
| GET | `/api/files` | List indexed files |
| DELETE | `/api/index` | Clear vector index |

## Ingest Request

```bash
curl -X POST http://localhost:3000/api/ingest \
  -F "file=@document.pdf" \
  -F "policy=sietch_secret" \
  -F "identity=paul"
```

## Query Request

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is attention?", "identity": "paul", "fileId": "file_123", "policy": "sietch_secret"}'
```

## Authorization Model

| Identity | Role | Public | Sietch Secret | Imperial Classified |
|----------|------|--------|---------------|---------------------|
| Paul | Fremen | ✅ | ✅ | ❌ |
| Gurney | Smuggler | ✅ | ❌ | ❌ |
| Harkonnen | Imperial Spy | ✅ | ❌ | ✅ |

## Project Structure

```
├── server.ts              # Express server (entry point)
├── api/
│   ├── utils/
│   │   ├── chunking.ts    # Header-based text chunking
│   │   ├── embeddings.ts  # Gemini embeddings
│   │   └── gemini.ts      # Gemini generation + vision
│   └── vector/
│       └── localStore.ts  # File-based vector index
├── public/
│   ├── index.html         # Terminal UI
│   ├── app.js             # Frontend logic
│   └── styles.css
├── dist/                  # Compiled output (gitignored)
├── .vector-index/         # Local vector storage (gitignored)
└── data/                  # Uploaded files (gitignored)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | TypeScript compile |
| `npm start` | Run production build |
| `npm run docker:build` | Build Docker image |
| `npm run docker:run` | Run container |
| `npm run docker:compose` | Docker Compose up |
| `npm run typecheck` | TypeScript check |

## License

MIT