export interface Chunk {
  id: string;
  text: string;
  headers: Record<string, string>;
  contentType: 'text_prose' | 'table' | 'image_description';
  metadata: Record<string, any>;
}

export interface ImageDescriptionResult {
  description: string;
  contentType: 'image_description';
}

export function chunkTextByHeaders(text: string, fileId: string): Chunk[] {
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  let currentChunk: { headers: Record<string, string>; content: string[] } = { headers: {}, content: [] };
  let headerStack: string[] = [];
  let chunkIndex = 0;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      if (currentChunk.content.length > 0) {
        const content = currentChunk.content.join('\n').trim();
        if (content.length > 20) {
          chunks.push({
            id: `${fileId}_chunk_${chunkIndex++}`,
            text: content,
            headers: { ...currentChunk.headers },
            contentType: 'text_prose',
            metadata: { ...currentChunk.headers }
          });
        }
      }

      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();
      headerStack = headerStack.slice(0, level - 1);
      headerStack.push(title);

      currentChunk = { headers: {}, content: [line] };
      headerStack.forEach((h, i) => {
        currentChunk.headers[`Header_${i + 1}`] = h;
      });
    } else {
      currentChunk.content.push(line);
    }
  }

  if (currentChunk.content.length > 0) {
    const content = currentChunk.content.join('\n').trim();
    if (content.length > 20) {
      chunks.push({
        id: `${fileId}_chunk_${chunkIndex++}`,
        text: content,
        headers: { ...currentChunk.headers },
        contentType: 'text_prose',
        metadata: { ...currentChunk.headers }
      });
    }
  }

  return chunks.filter(c => c.text.length > 20);
}

export function createImageChunk(fileId: string, description: string, index: number): Chunk {
  return {
    id: `${fileId}_visual_${index}`,
    text: description,
    headers: {},
    contentType: 'image_description',
    metadata: { isVisual: true }
  };
}

export function createTableChunk(fileId: string, tableMarkdown: string, index: number): Chunk {
  return {
    id: `${fileId}_table_${index}`,
    text: `[Explicit Table Extraction #${index}]:\n${tableMarkdown}`,
    headers: {},
    contentType: 'table',
    metadata: { contentType: 'table', tableIndex: index }
  };
}