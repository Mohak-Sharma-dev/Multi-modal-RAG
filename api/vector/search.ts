import { Redis } from '@upstash/redis';

const INDEX_NAME = process.env.INDEX_NAME || 'rag_vectors';

export interface SearchResult {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, any>;
}

export async function search(
  redis: Redis,
  queryVector: number[],
  options: {
    k?: number;
    fileId?: string;
    policy?: string;
    contentType?: string;
  } = {}
): Promise<SearchResult[]> {
  const { k = 4, fileId, policy, contentType } = options;

  await createVectorIndex(redis);

  const filterParts: string[] = ['*'];
  if (fileId) filterParts.push(`@fileId:{${fileId}}`);
  if (policy) filterParts.push(`@policy:{${policy}}`);
  if (contentType) filterParts.push(`@contentType:{${contentType}}`);
  
  const filter = filterParts.join(' ');

  const vectorBlob = Buffer.from(new Float32Array(queryVector).buffer).toString('base64');

  const query = `*=>[KNN ${k} @vector $vec AS score]`;
  
  try {
    const index = redis.search.index({ name: INDEX_NAME }) as any;
    const results = await index.query({
      query,
      params: { vec: vectorBlob },
      dialect: 2,
      sortBy: 'score',
      limit: { from: 0, size: k },
      return: ['id', 'score', 'text', 'metadata'],
      filter: filter !== '*' ? filter : undefined
    });

    return results.map((doc: any) => ({
      id: doc.id,
      score: parseFloat(doc.score),
      text: doc.text || '',
      metadata: doc.metadata ? JSON.parse(doc.metadata) : {}
    }));
  } catch (error) {
    console.error('Vector search error:', error);
    return [];
  }
}

async function createVectorIndex(redis: Redis): Promise<void> {
  try {
    await redis.search.createIndex({
      name: INDEX_NAME,
      schema: {
        '$.vector': { type: 'VECTOR', algorithm: 'FLAT', attributes: { TYPE: 'FLOAT32', DIM: 768, DISTANCE_METRIC: 'COSINE' } },
        '$.metadata.fileId': { type: 'TAG', as: 'fileId' },
        '$.metadata.policy': { type: 'TAG', as: 'policy' },
        '$.metadata.contentType': { type: 'TAG', as: 'contentType' },
        '$.text': { type: 'TEXT', as: 'text' }
      },
      on: 'JSON'
    } as any);
  } catch (error: any) {
    if (!error.message?.includes('already exists')) {
      throw error;
    }
  }
}