import { Redis } from '@upstash/redis';

const INDEX_NAME = process.env.INDEX_NAME || 'rag_vectors';

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, any>;
}

export async function createVectorIndex(redis: Redis): Promise<void> {
  try {
    await redis.exec([
      'FT.CREATE', INDEX_NAME, 'ON', 'JSON', 'SCHEMA',
      '$.vector', 'AS', 'vector', 'VECTOR', 'FLAT', '6', 'TYPE', 'FLOAT32', 'DIM', '768', 'DISTANCE_METRIC', 'COSINE',
      '$.metadata.fileId', 'AS', 'fileId', 'TAG',
      '$.metadata.policy', 'AS', 'policy', 'TAG',
      '$.metadata.contentType', 'AS', 'contentType', 'TAG',
      '$.text', 'AS', 'text', 'TEXT'
    ]);
  } catch (error: any) {
    if (!error.message?.includes('already exists')) {
      throw error;
    }
  }
}

export async function upsertVectors(redis: Redis, records: VectorRecord[]): Promise<void> {
  if (records.length === 0) return;

  for (const record of records) {
    const key = `${INDEX_NAME}:chunks:${record.id}`;
    const doc = {
      id: record.id,
      vector: record.vector,
      text: record.metadata.text || '',
      metadata: record.metadata
    };
    await redis.exec(['JSON.SET', key, '$', JSON.stringify(doc)]);
  }
}