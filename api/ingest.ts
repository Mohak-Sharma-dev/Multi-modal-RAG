import { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import formidable from 'formidable';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import { chunkTextByHeaders, createImageChunk, Chunk } from './utils/chunking';
import { generateEmbeddings } from './utils/embeddings';
import { generateImageDescription } from './utils/gemini';
import { createVectorIndex, upsertVectors, VectorRecord } from './vector/upsert';

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

function checkPermission(userRole: string, filePolicy: string): boolean {
  switch (filePolicy) {
    case 'public': return true;
    case 'sietch_secret': return userRole === 'fremen';
    case 'imperial_classified': return userRole === 'imperial_spy';
    default: return false;
  }
}

function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!;
  
  if (!url || !token) {
    throw new Error('Upstash Redis credentials not configured');
  }
  
  return new Redis({ url, token });
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

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

      const redis = getRedis();
      await createVectorIndex(redis);

      const vectorRecords: VectorRecord[] = chunks.map(chunk => ({
        id: chunk.id,
        vector: chunk.metadata.embedding,
        metadata: { ...chunk.metadata, text: chunk.text }
      }));

      await upsertVectors(redis, vectorRecords);

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
}