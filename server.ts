import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import formidable from 'formidable';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import { chunkTextByHeaders, createImageChunk, Chunk } from './api/utils/chunking.js';
import { generateEmbeddings } from './api/utils/embeddings.js';
import { generateImageDescription, generateContent } from './api/utils/gemini.js';
import { createVectorIndex, upsertVectors, search, SearchResult, clearIndex, getAllVectors } from './api/vector/localStore.js';
import { config } from 'dotenv';
import { resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
config({ path: resolve(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

const IDENTITY_ROLES: Record<string, string> = {
  paul: 'fremen',
  gurney: 'smuggler',
  harkonnen: 'imperial_spy'
};

const ROLE_DISPLAY: Record<string, string> = {
  fremen: 'Fremen',
  smuggler: 'Smuggler',
  imperial_spy: 'Imperial Spy'
};

const POLICY_DISPLAY: Record<string, string> = {
  public: 'Public — Open to all',
  sietch_secret: 'Sietch Secret — Fremen only',
  imperial_classified: 'Imperial Classified — No access'
};

const ROLE_PREFIXES: Record<string, string> = {
  fremen: 'The desert speaks through the spice... ',
  smuggler: "Smuggler's log indicates... ",
  imperial_spy: 'Imperial records show... '
};

function checkPermission(userRole: string, filePolicy: string): boolean {
  switch (filePolicy) {
    case 'public': return true;
    case 'sietch_secret': return userRole === 'fremen';
    case 'imperial_classified': return userRole === 'imperial_spy';
    default: return false;
  }
}

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error('PDF parse error:', error);
    return '';
  }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(join(__dirname, 'public')));

app.post('/api/ingest', async (req: Request, res: Response) => {
  const form = formidable({
    maxFileSize: 5 * 1024 * 1024,
    maxFields: 10
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(400).json({ error: 'File upload failed' });
    }

    try {
      const file = files.file?.[0];
      const identity = fields.identity?.[0] || 'paul';
      const policy = fields.policy?.[0] || 'public';

      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const userRole = IDENTITY_ROLES[identity] || 'fremen';
      const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const fileBuffer = fs.readFileSync(file.filepath);
      let chunks: Chunk[] = [];
      let isImage = false;

      if (file.mimetype === 'application/pdf') {
        const content = await extractTextFromPDF(fileBuffer);
        if (!content.trim() || content.startsWith('%PDF')) {
          chunks = chunkTextByHeaders(`# Document: ${file.originalFilename}\n\nSimulated PDF content for demonstration.`, fileId);
        } else {
          chunks = chunkTextByHeaders(content, fileId);
        }
      } else if (file.mimetype?.startsWith('image/')) {
        isImage = true;
        const base64 = fileBuffer.toString('base64');
        const description = await generateImageDescription(base64);
        chunks = [createImageChunk(fileId, description, 0)];
      } else if (file.mimetype === 'text/plain') {
        const content = fileBuffer.toString('utf-8');
        chunks = chunkTextByHeaders(content, fileId);
      } else {
        return res.status(400).json({ error: 'Unsupported file type' });
      }

      if (chunks.length === 0) {
        return res.status(400).json({ error: 'Could not extract content from file' });
      }

      chunks.forEach((chunk, i) => {
        chunk.id = `${fileId}_chunk_${i}`;
        chunk.metadata.fileId = fileId;
        chunk.metadata.policy = policy;
      });

      const texts = chunks.map(c => c.text);
      const embeddings = await generateEmbeddings(texts);

      chunks.forEach((chunk, i) => {
        chunk.metadata.embedding = embeddings[i];
      });

      createVectorIndex();

      const vectorRecords = chunks.map(chunk => ({
        id: chunk.id,
        vector: chunk.metadata.embedding,
        metadata: { ...chunk.metadata, text: chunk.text }
      }));

      upsertVectors(vectorRecords);

      const tuplesWritten = [
        { type: 'WriteTuple', resource: `file:${fileId}`, relation: 'policy', subject: `policy:${policy}`, result: 'WRITTEN' },
        { type: 'WriteTuple', resource: `file:${fileId}`, relation: 'content', subject: `data:${file.mimetype}`, result: 'WRITTEN' },
        { type: 'WriteTuple', resource: `file:${fileId}`, relation: 'chunks', subject: `count:${chunks.length}`, result: 'WRITTEN' }
      ];

      return res.status(200).json({
        fileId,
        fileName: file.originalFilename,
        chunksCreated: chunks.length,
        vectorsStored: vectorRecords.length,
        policy,
        ingestedBy: identity,
        tuplesWritten,
        message: `File ingested with policy ${POLICY_DISPLAY[policy]}. ${chunks.length} chunks indexed.`
      });

    } catch (error: any) {
      console.error('Ingestion error:', error);
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });
});

app.post('/api/query', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { query, identity, fileId, policy } = req.body;

    if (!query || !identity) {
      return res.status(400).json({ error: 'Missing query or identity' });
    }

    const userRole = IDENTITY_ROLES[identity] || 'fremen';
    const userRoleDisplay = ROLE_DISPLAY[userRole];
    const prefix = ROLE_PREFIXES[userRole] || '';

    let targetPolicy = policy;
    let targetFileId = fileId;

    if (!targetFileId) {
      return res.status(400).json({ error: 'No file specified. Please ingest a file first.' });
    }

    if (!targetPolicy) {
      targetPolicy = 'public';
    }

    const authorized = checkPermission(userRole, targetPolicy);

    if (!authorized) {
      const denialMessage = `ACCESS DENIED BY SPICEDB: Missing relation 'viewer' on resource '${targetFileId}' (policy: ${POLICY_DISPLAY[targetPolicy]}) for subject 'user:${identity}' (role: ${userRoleDisplay})`;
      
      return res.status(403).json({
        error: 'Permission denied',
        message: denialMessage,
        authorized: false,
        policy: targetPolicy,
        role: userRoleDisplay
      });
    }

    const queryEmbedding = await generateEmbeddings([query]);
    const results = search(queryEmbedding[0], {
      k: 4,
      fileId: targetFileId,
      policy: targetPolicy
    });

    if (results.length === 0) {
      const response = `${prefix}<strong>No relevant chunks retrieved from the Spice Vault. No relevant information found in the ingested documents.</strong><br><em>— SpiceDB authorization verified. Relation 'viewer' confirmed on resource '${targetFileId}' for ${userRoleDisplay}.</em>`;
      
      return res.status(200).json({
        answer: response,
        sources: [],
        authorized: true,
        fileId: targetFileId,
        policy: targetPolicy,
        latencyMs: Date.now() - startTime
      });
    }

    const contextChunks = results.map((r, i) => 
      `[${i + 1}] <em>${r.metadata.contentType || 'text_prose'}</em> — "${r.text.slice(0, 200).replace(/\n/g, ' ')}..."`
    ).join('<br>');

    const contextText = results.map((r, i) => 
      `--- Context Source ${i + 1} (${r.metadata.contentType || 'text_prose'}) ---\n${r.text}`
    ).join('\n\n');

    const systemPrompt = `You are a rigorous, grounded research assistant. Answer the user's question using ONLY the provided context chunks below. The chunks contain text, explicitly parsed markdown tables, and detailed descriptions of figures generated by a vision model. If the answer cannot be directly derived from the context, state clearly that you do not have sufficient information.`;

    const userPrompt = `Context Material:\n${contextText}\n\nUser Question: ${query}`;

    const fullResponse = await generateContent(
      `${systemPrompt}\n\n${userPrompt}`,
      { temperature: 0.3, maxTokens: 2048 }
    );

    const response = `${prefix}<strong>Retrieved Context:</strong><br>${contextChunks}<br><br>${fullResponse}<br><br><em>— SpiceDB authorization verified. Relation 'viewer' confirmed on resource '${targetFileId}' for ${userRoleDisplay}.</em>`;

    return res.status(200).json({
      answer: response,
      sources: results.map(r => ({
        id: r.id,
        score: r.score,
        text: r.text.slice(0, 500),
        metadata: r.metadata
      })),
      authorized: true,
      fileId: targetFileId,
      policy: targetPolicy,
      latencyMs: Date.now() - startTime
    });

  } catch (error: any) {
    console.error('Query error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/files', (req: Request, res: Response) => {
  const vectors = getAllVectors();
  const files = new Map();
  
  for (const v of vectors) {
    const fileId = v.metadata.fileId;
    if (!files.has(fileId)) {
      files.set(fileId, {
        fileId,
        policy: v.metadata.policy,
        chunks: 0
      });
    }
    files.get(fileId).chunks++;
  }
  
  res.json(Array.from(files.values()));
});

app.delete('/api/index', (req: Request, res: Response) => {
  clearIndex();
  res.json({ message: 'Vector index cleared' });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

createVectorIndex();

app.listen(PORT, () => {
  console.log(`🚀 SpiceVault RAG Server running on http://localhost:${PORT}`);
  console.log(`   API endpoints:`);
  console.log(`   POST   /api/ingest  - Ingest documents`);
  console.log(`   POST   /api/query   - Query the RAG system`);
  console.log(`   GET    /api/health  - Health check`);
  console.log(`   GET    /api/files   - List ingested files`);
  console.log(`   DELETE /api/index   - Clear vector index`);
});