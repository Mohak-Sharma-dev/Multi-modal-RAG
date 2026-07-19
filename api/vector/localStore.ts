import fs from 'fs';
import path from 'path';

const INDEX_DIR = path.join(process.cwd(), '.vector-index');
const INDEX_FILE = path.join(INDEX_DIR, 'vectors.json');

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, any>;
}

export interface SearchResult {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, any>;
}

let indexInitialized = false;
let vectors: VectorRecord[] = [];

function ensureIndexDir(): void {
  if (!fs.existsSync(INDEX_DIR)) {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
  }
}

function loadIndex(): void {
  if (indexInitialized) return;
  
  ensureIndexDir();
  
  if (fs.existsSync(INDEX_FILE)) {
    try {
      const data = fs.readFileSync(INDEX_FILE, 'utf-8');
      vectors = JSON.parse(data);
    } catch (error) {
      console.error('Error loading vector index:', error);
      vectors = [];
    }
  } else {
    vectors = [];
  }
  
  indexInitialized = true;
}

function saveIndex(): void {
  ensureIndexDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(vectors, null, 2));
}

export function createVectorIndex(): void {
  loadIndex();
}

export function upsertVectors(records: VectorRecord[]): void {
  loadIndex();
  
  for (const record of records) {
    const existingIndex = vectors.findIndex(v => v.id === record.id);
    if (existingIndex >= 0) {
      vectors[existingIndex] = record;
    } else {
      vectors.push(record);
    }
  }
  
  saveIndex();
}

export function search(
  queryVector: number[],
  options: {
    k?: number;
    fileId?: string;
    policy?: string;
    contentType?: string;
  } = {}
): SearchResult[] {
  loadIndex();
  
  const { k = 4, fileId, policy, contentType } = options;
  
  let filtered = vectors;
  
  if (fileId) {
    filtered = filtered.filter(v => v.metadata.fileId === fileId);
  }
  
  if (policy) {
    filtered = filtered.filter(v => v.metadata.policy === policy);
  }
  
  if (contentType) {
    filtered = filtered.filter(v => v.metadata.contentType === contentType);
  }
  
  const results: SearchResult[] = filtered.map(v => {
    const score = cosineSimilarity(queryVector, v.vector);
    return {
      id: v.id,
      score,
      text: v.metadata.text || '',
      metadata: v.metadata
    };
  });
  
  results.sort((a, b) => b.score - a.score);
  
  return results.slice(0, k);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function clearIndex(): void {
  vectors = [];
  if (fs.existsSync(INDEX_FILE)) {
    fs.unlinkSync(INDEX_FILE);
  }
  indexInitialized = true;
}

export function getAllVectors(): VectorRecord[] {
  loadIndex();
  return vectors;
}

export function getVectorCount(): number {
  loadIndex();
  return vectors.length;
}