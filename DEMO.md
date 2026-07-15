# DEMO.md — Local Run Guide

## Prerequisites
- A modern browser (Chrome, Firefox, Edge, Safari)
- No Node.js, Python, or Docker required

---

## 1. Local Installation

```bash
# Clone or download the project
git clone <your-repo-url> Multi-modal-RAG
cd Multi-modal-RAG

# Verify files exist
ls -la
# Should show:
#   app.js
#   spicedb-dune-demo.html
#   source/attention_is_all_you_need.pdf   (optional demo PDF)
#   AGENTS.md
#   requirements.txt   (Python deps — NOT needed for demo)
```

---

## 2. Run Locally

### Option A: Double-click (simplest)
```bash
# Windows
start spicedb-dune-demo.html

# macOS
open spicedb-dune-demo.html

# Linux
xdg-open spicedb-dune-demo.html
```

### Option B: Local HTTP server (recommended — avoids CORS issues with file://)
```bash
# Python 3 (if available)
python3 -m http.server 8000

# Node.js (if available)
npx serve .

# PHP (if available)
php -S localhost:8000
```
Then open: **http://localhost:8000/spicedb-dune-demo.html**

---

## 3. Demo Workflow

1. **Upload a file**
   - Drag & drop or click the **Ingestion Chamber** zone
   - Accepted: `.pdf`, `.txt`, `.png`, `.jpg` (≤ 5 MB)
   - Select a policy: *Public*, *Sietch Secret (Fremen only)*, *Imperial Classified (Harkonnen only)*

2. **Ingest**
   - Click **Ingest to Spice Vault**
   - Watch the progress bar (simulated Docling + TF-IDF indexing)

3. **Switch identity** (top-right)
   - **Paul Atreides** → Fremen (can read Sietch Secret)
   - **Gurney Halleck** → Smuggler (Public only)
   - **Harkonnen Agent** → Imperial Spy (Public only)

4. **Query the Oracle**
   - Type a question in the middle panel
   - Click **Consult the Oracle**
   - SpiceDB permission check runs → if allowed, RAG retrieval + response

5. **Observe logs**
   - **Left panel**: Tuple Store (SpiceDB writes)
   - **Right panel**: Live Auth Feed (CheckPermission results)
   - **Middle panel → Audit Tab**: Full audit trail

---

## 4. Test Files

Use the included PDF for a multi-modal test:
```
source/attention_is_all_you_need.pdf
```
Upload with **Sietch Secret** policy → only Paul (Fremen) can query it.

Or create a test `.txt`:
```bash
echo -e "# Dune\n\nThe spice must flow.\n\n## Chapter 1\n\nArrakis teaches the attitude of the knife." > test.txt
```

---

## 5. Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank page / errors in console | Use a local HTTP server (Option B), not `file://` |
| "File too large" | Must be ≤ 5 MB |
| "Invalid file type" | Only PDF, TXT, PNG, JPG accepted |
| Query returns "No files in Spice Vault" | Ingest a file first |
| Access denied | Switch identity to match the file's policy |

---

## 6. Deploy to Vercel (Static)

```bash
# No build step needed
vercel deploy
```
Or push to GitHub → import in Vercel → **Framework Preset: Other** → **Build Command: (empty)** → **Output Directory: .**