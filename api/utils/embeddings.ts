import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('[Embeddings] GEMINI_API_KEY not set in environment');
}
const genAI = new GoogleGenerativeAI(apiKey || '');
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768;

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  console.log('[Embeddings] Generating embedding for text length:', text.length);
  const result = await model.embedContent(text);
  console.log('[Embeddings] Embedding generated, dimensions:', result.embedding.values.length);
  return result.embedding.values;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  console.log('[Embeddings] Batch generating', texts.length, 'embeddings');
  const results = await Promise.all(
    texts.map(text => model.embedContent(text))
  );
  return results.map(r => r.embedding.values);
}

export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}