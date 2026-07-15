// app.js - Multi-Modal RAG Pipeline (Client-Side Simulation)
// Dune/SpiceDB themed - No heavy backends, all in-memory

const gameState = {
  // Identity & Permissions
  currentIdentity: 'paul', // 'paul' | 'gurney' | 'harkonnen'
  roleMap: {
    paul: 'fremen',
    gurney: 'smuggler',
    harkonnen: 'imperial_spy'
  },
  roleDisplay: {
    fremen: 'Fremen',
    smuggler: 'Smuggler',
    imperial_spy: 'Imperial Spy'
  },

  // Ingestion State
  pendingFile: null,
  fileLedger: [], // Ingested files with metadata + content
  nextFileId: 1,

  // Vector Store Simulation
  vectorIndex: [], // Array of { id, text, embedding: number[], metadata, fileId }

  // Auth Log Filter
  authLogFilter: 'all', // 'all' | 'allowed' | 'denied'

  // UI Elements (populated in init)
  elements: {}
};

// ============================================================================
// UTILITIES
// ============================================================================

const els = (id) => document.getElementById(id);

function getTimestamp() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({'&':'&','<':'<','>':'>','"':'"',"'":''}[s]));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(2)} MB`;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getCurrentUserRole() {
  return gameState.roleMap[gameState.currentIdentity];
}

function getCurrentUserName() {
  return gameState.currentIdentity;
}

function getCurrentUserDisplay() {
  return gameState.roleDisplay[getCurrentUserRole()];
}

const POLICY_DISPLAY = {
  public: 'Public — Open to all',
  sietch_secret: 'Sietch Secret — Fremen only',
  imperial_classified: 'Imperial Classified — No access'
};

// ============================================================================
// SPICEDB PERMISSION SIMULATION
// ============================================================================

// Schema: user{relation viewer: user}, file{permission view = viewer}
// Policies:
// - public: viewer = user:* (any user)
// - sietch_secret: viewer = user:paul (only fremen)
// - imperial_classified: viewer = user:harkonnen (only harkonnen)

function checkSpiceDBPermission(userRole, filePolicy) {
  switch (filePolicy) {
    case 'public':
      return true;
    case 'sietch_secret':
      return userRole === 'fremen';
    case 'imperial_classified':
      return userRole === 'imperial_spy';
    default:
      return false;
  }
}

// ============================================================================
// TEXT PROCESSING / CHUNKING (Simulated Docling + MarkdownHeaderTextSplitter)
// ============================================================================

function chunkTextByHeaders(text) {
  // Simulate MarkdownHeaderTextSplitter: split on #, ##, ### headers
  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = { headers: {}, content: [] };
  let headerStack = [];

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      // Save previous chunk if has content
      if (currentChunk.content.length > 0) {
        chunks.push({
          headers: { ...currentChunk.headers },
          content: currentChunk.content.join('\n').trim()
        });
      }
      // Update header stack
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();
      headerStack = headerStack.slice(0, level - 1);
      headerStack.push(title);
      // Start new chunk
      currentChunk = { headers: {}, content: [line] };
      headerStack.forEach((h, i) => {
        currentChunk.headers[`Header_${i+1}`] = h;
      });
    } else {
      currentChunk.content.push(line);
    }
  }
  // Push final chunk
  if (currentChunk.content.length > 0) {
    chunks.push({
      headers: { ...currentChunk.headers },
      content: currentChunk.content.join('\n').trim()
    });
  }
  // Filter empty
  return chunks.filter(c => c.content.length > 20);
}

// ============================================================================
// SIMPLE TF-IDF EMBEDDING SIMULATION (In-Memory Vector Store)
// ============================================================================

// Build vocabulary from all chunks
function buildVocabulary(chunks) {
  const vocab = new Set();
  for (const chunk of chunks) {
    if (!chunk) continue;
    const words = tokenize(chunk.text || '');
    for (const w of words) vocab.add(w);
  }
  return Array.from(vocab);
}

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function computeTFIDF(chunks, vocab) {
  const N = chunks.length;
  const docFreq = new Map();
  // Document frequency
  for (const chunk of chunks) {
    if (!chunk) continue;
    const uniqueWords = new Set(tokenize(chunk.text || ''));
    for (const w of uniqueWords) {
      docFreq.set(w, (docFreq.get(w) || 0) + 1);
    }
  }
  // TF-IDF vectors
  const vectors = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    const words = tokenize(chunk.text || '');
    const tf = new Map();
    for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
    // Normalize TF
    const maxTf = Math.max(...tf.values()) || 1;
    const vec = new Array(vocab.length).fill(0);
    for (let i = 0; i < vocab.length; i++) {
      const w = vocab[i];
      if (tf.has(w)) {
        const tfNorm = tf.get(w) / maxTf;
        const idf = Math.log(N / (docFreq.get(w) || 1));
        vec[i] = tfNorm * idf;
      }
    }
    vectors.push(vec);
  }
  return vectors;
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function embedQuery(query, vocab, docFreq, N) {
  const words = tokenize(query);
  const tf = new Map();
  for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
  const maxTf = Math.max(...tf.values()) || 1;
  const vec = new Array(vocab.length).fill(0);
  for (let i = 0; i < vocab.length; i++) {
    const w = vocab[i];
    if (tf.has(w)) {
      const tfNorm = tf.get(w) / maxTf;
      const idf = Math.log(N / (docFreq.get(w) || 1));
      vec[i] = tfNorm * idf;
    }
  }
  return vec;
}

// ============================================================================
// VECTOR INDEX MANAGEMENT
// ============================================================================

function rebuildVectorIndex() {
  // Collect all text chunks from all files
  const allChunks = [];
  for (const file of gameState.fileLedger) {
    if (file.chunks) {
      for (const chunk of file.chunks) {
        allChunks.push({
          ...chunk,
          fileId: file.id,
          fileName: file.name,
          filePolicy: file.policy
        });
      }
    }
  }

  if (allChunks.length === 0) {
    gameState.vectorIndex = [];
    gameState.vocab = [];
    gameState.docFreq = new Map();
    gameState.docCount = 0;
    return;
  }

  const vocab = buildVocabulary(allChunks);
  
  // Compute document frequencies for IDF
  const docFreq = new Map();
  for (const chunk of allChunks) {
    if (!chunk) continue;
    const uniqueWords = new Set(tokenize(chunk.text || ''));
    for (const w of uniqueWords) {
      docFreq.set(w, (docFreq.get(w) || 0) + 1);
    }
  }
  
  const vectors = computeTFIDF(allChunks, vocab);

  gameState.vectorIndex = allChunks.map((chunk, i) => ({
    ...chunk,
    vector: vectors[i]
  }));
  gameState.vocab = vocab;
  gameState.docFreq = docFreq;
  gameState.docCount = allChunks.length;
}

function searchVectorIndex(query, k = 4) {
  if (gameState.vectorIndex.length === 0) return [];
  const queryVec = embedQuery(query, gameState.vocab, gameState.docFreq, gameState.docCount);
  const scored = gameState.vectorIndex.map(item => ({
    ...item,
    score: cosineSimilarity(queryVec, item.vector)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).filter(r => r.score > 0.01);
}

// ============================================================================
// IMAGE PROCESSING SIMULATION (Gemini Vision Mock)
// ============================================================================

const IMAGE_DESCRIPTIONS = [
  'A detailed architectural diagram showing the Transformer encoder-decoder structure with multi-head attention layers, feed-forward networks, and residual connections.',
  'A visualization of the attention mechanism displaying query, key, value matrices and the scaled dot-product computation with softmax normalization.',
  'A training curve chart showing BLEU scores improving over training steps for both EN-DE and EN-FR translation tasks, with the Transformer outperforming RNN and CNN baselines.',
  'A positional encoding heatmap illustrating sinusoidal patterns across sequence positions and embedding dimensions.',
  'A diagram of the multi-head attention mechanism with 8 parallel attention heads processing different representation subspaces.',
  'An illustration of the encoder stack with 6 identical layers, each containing self-attention and position-wise feed-forward sub-layers.',
  'A visualization of masked self-attention in the decoder preventing positions from attending to subsequent positions during training.',
  'A comparison table showing model size, training time, and BLEU scores across different architectures.'
];

function generateImageDescription(fileName, index) {
  // Simulate Gemini Vision: return a deterministic but varied description
  const descIndex = (fileName.length + index) % IMAGE_DESCRIPTIONS.length;
  return `[Visual Analysis: ${fileName}] ${IMAGE_DESCRIPTIONS[descIndex]} This figure illustrates key architectural components from the \"Attention Is All You Need\" paper.`;
}

// ============================================================================
// FILE INGESTION PIPELINE
// ============================================================================

async function handleFileSelect(file) {
  // Validate
  const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
  if (!validTypes.includes(file.type)) {
    alert('Invalid file type. Accepted: PDF, PNG, JPG, TXT');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('File too large. Maximum 5MB.');
    return;
  }

  gameState.pendingFile = file;

  // Update preview UI
  els.previewName.textContent = file.name;
  els.previewSize.textContent = formatSize(file.size);
  if (file.type.startsWith('image/')) {
    els.previewThumb.src = URL.createObjectURL(file);
    els.previewThumb.hidden = false;
  } else {
    els.previewThumb.hidden = true;
    els.previewThumb.src = '';
  }
  els.filePreview.classList.add('visible');
  els.ingestBtn.disabled = false;
  els.uploadZone.classList.add('has-file');
}

async function simulateIngestionProgress() {
  els.progressContainer.hidden = false;
  els.progressContainer.classList.add('visible');
  els.ingestBtn.disabled = true;

  const steps = [
    { progress: 10, text: 'The spice must flow... parsing document structure...' },
    { progress: 25, text: 'Extracting text, tables, and figures via Docling simulation...' },
    { progress: 45, text: 'Chunking by markdown headers — structural segmentation...' },
    { progress: 60, text: 'Computing TF-IDF embeddings for vector index...' },
    { progress: 75, text: 'Analyzing visual elements with simulated Gemini Vision...' },
    { progress: 90, text: 'Writing tuples to SpiceDB ledger — establishing viewer relations...' },
    { progress: 100, text: 'Ingestion complete. The archives remember.' }
  ];

  for (const step of steps) {
    els.progressFill.style.width = step.progress + '%';
    els.progressText.textContent = step.text;
    await delay(300 + Math.random() * 200);
  }

  await delay(400);
  els.progressContainer.classList.remove('visible');
  els.progressContainer.hidden = true;
  els.progressFill.style.width = '0%';
}

async function completeIngestion() {
  const file = gameState.pendingFile;
  const policy = els.policySelect.value;
  const fileId = `file_${String(gameState.nextFileId++).padStart(3, '0')}`;
  const userRole = getCurrentUserRole();
  const userName = getCurrentUserName();

  // Read file content
  let content = '';
  let isImage = false;
  let imageDesc = null;

  if (file.type.startsWith('image/')) {
    isImage = true;
    content = await fileToBase64(file);
    // Simulate vision analysis
    imageDesc = generateImageDescription(file.name, gameState.fileLedger.length);
  } else if (file.type === 'application/pdf') {
    // For PDF, readAsText returns binary garbage. Detect and fall back to simulation.
    content = await fileToText(file);
    const isBinaryGarbage = content.startsWith('%PDF') || /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 500));
    if (!content.trim() || isBinaryGarbage) {
      content = simulatePDFContent(file.name);
    }
  } else {
    content = await fileToText(file);
  }

  // Chunk text content
  let chunks = [];
  if (!isImage && content.trim()) {
    const rawChunks = chunkTextByHeaders(content);
    chunks = rawChunks.map((c, i) => ({
      id: `${fileId}_chunk_${i}`,
      text: c.content,
      headers: c.headers,
      contentType: 'text_prose',
      metadata: {
        source: file.name,
        chunkIndex: i,
        ...c.headers
      }
    }));
  }

  // For images, create a visual chunk
  if (isImage && imageDesc) {
    chunks.push({
      id: `${fileId}_visual_0`,
      text: imageDesc,
      headers: {},
      contentType: 'image_description',
      metadata: { source: file.name, chunkIndex: 0, isVisual: true }
    });
  }

  // Create file record
  const fileRecord = {
    id: fileId,
    name: file.name,
    size: file.size,
    type: file.type,
    policy: policy,
    content: content,
    isImage: isImage,
    imageDesc: imageDesc,
    chunks: chunks,
    ingestedBy: gameState.currentIdentity,
    ingestedAt: new Date().toISOString()
  };

  gameState.fileLedger.push(fileRecord);

  // Log tuple writes (Left Panel - Tuple Store)
  logTupleEntry({
    type: 'WriteTuple',
    user: userName,
    resource: `file:${fileId}`,
    relation: 'policy',
    subject: `policy:${policy}`,
    result: 'WRITTEN'
  });

  logTupleEntry({
    type: 'WriteTuple',
    user: userName,
    resource: `file:${fileId}`,
    relation: 'content',
    subject: `data:${file.type}`,
    result: 'WRITTEN'
  });

  if (chunks.length > 0) {
    logTupleEntry({
      type: 'WriteTuple',
      user: userName,
      resource: `file:${fileId}`,
      relation: 'chunks',
      subject: `count:${chunks.length}`,
      result: 'WRITTEN'
    });
  }

  // Auth Log (Right Panel)
  logAuthEntry({
    type: 'WriteTuple', user: userName, resource: `file:${fileId}`,
    relation: 'policy', subject: `policy:${policy}`, permission: 'write', result: 'WRITTEN'
  });
  logAuthEntry({
    type: 'WriteTuple', user: userName, resource: `file:${fileId}`,
    relation: 'content', subject: `data:${file.type}`, permission: 'write', result: 'WRITTEN'
  });
  logAuthEntry({
    type: 'IngestComplete', user: userName, resource: `file:${fileId}`,
    policy: policy, result: 'SUCCESS', fileId: fileId
  });

  // Audit Log (Middle Panel - Audit Tab)
  logAuditEntry({
    type: 'IngestComplete', user: userName, resource: `file:${fileId}`,
    policy: policy, result: 'SUCCESS'
  });

  // Rebuild vector index
  rebuildVectorIndex();

  // Reset UI
  gameState.pendingFile = null;
  els.filePreview.classList.remove('visible');
  els.previewThumb.src = '';
  els.previewThumb.hidden = true;
  els.fileInput.value = '';
  els.policySelect.value = 'public';
  els.ingestBtn.disabled = true;
  els.uploadZone.classList.remove('has-file');

  // Enable query panel
  enableQueryPanel();

  // System message
  addChatMessage({
    type: 'system',
    text: `File <strong>${escapeHtml(file.name)}</strong> ingested with policy <strong>${POLICY_DISPLAY[policy]}</strong>. ${chunks.length} chunks indexed. Tuples written to SpiceDB.`
  });

  updateConsultButtonState();
}

function simulatePDFContent(fileName) {
  // Return simulated content for "Attention Is All You Need" paper
  if (fileName.toLowerCase().includes('attention')) {
    return `# Attention Is All You Need

## Abstract
The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.

## Introduction
Recurrent neural networks, long short-term memory and gated recurrent neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation. Numerous efforts have since been made to push the boundaries of recurrent language models and encoder-decoder architectures.

## Model Architecture
### Encoder and Decoder Stacks
The Transformer follows the overall encoder-decoder structure. The encoder is composed of a stack of N = 6 identical layers. Each layer has two sub-layers: a multi-head self-attention mechanism and a position-wise fully connected feed-forward network.

### Attention
An attention function can be described as mapping a query and a set of key-value pairs to an output. We compute the attention weights as: Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V.

### Multi-Head Attention
Instead of performing a single attention function with d_model-dimensional keys, values and queries, we project the queries, keys and values h = 8 times with different learned linear projections. This allows the model to jointly attend to information from different representation subspaces.

### Applications in Our Model
The Transformer uses multi-head attention in three different ways: encoder-decoder attention, encoder self-attention, and decoder self-attention.

## Training
We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs. The model achieves 28.4 BLEU on EN-DE and 41.8 BLEU on EN-FR.

## Results
### Machine Translation
On the WMT 2014 English-to-German translation task, the Transformer model achieves 28.4 BLEU, outperforming all previous models. On English-to-French, it achieves 41.8 BLEU.

### Model Variations
We evaluate the effect of varying the number of attention heads and the dimensionality of keys/values. Using 8 heads with d_k = d_v = 64 yields the best results.`;
  }
  // Generic PDF content
  return `# Document: ${fileName}\n\nThis is a simulated PDF extraction. The document contains structural headings, paragraphs, and potentially tables and figures that would be processed by the Docling pipeline.`;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ============================================================================
// QUERY PROCESSING (SpiceDB Guard + RAG)
// ============================================================================

async function processQuery(query) {
  const userRole = getCurrentUserRole();
  const userName = getCurrentUserName();

  // Find most recent file (demo: single file RAG)
  const targetFile = gameState.fileLedger[gameState.fileLedger.length - 1];
  if (!targetFile) {
    addChatMessage({
      type: 'denied',
      text: 'No files in the Spice Vault. Ingest a file first.'
    });
    return;
  }

  // =============================================================================
  // CRITICAL: SPICEDB PERMISSION CHECK — GUARDS THE RAG RETRIEVAL STEP
  // =============================================================================
  const authorized = checkSpiceDBPermission(userRole, targetFile.policy);

  // Log the CheckPermission call
  logAuthEntry({
    type: 'CheckPermission',
    user: userName,
    resource: targetFile.id,
    relation: 'viewer',
    subject: `user:${userName}`,
    permission: 'view',
    result: authorized ? 'ALLOWED' : 'DENIED',
    policy: targetFile.policy,
    role: userRole
  });

  logAuditEntry({
    type: 'CheckPermission',
    user: userName,
    resource: targetFile.id,
    policy: targetFile.policy,
    result: authorized ? 'ALLOWED' : 'DENIED'
  });

  if (!authorized) {
    // ACCESS DENIED — Block RAG retrieval entirely
    addChatMessage({
      type: 'denied',
      text: `ACCESS DENIED BY SPICEDB: Missing relation 'viewer' on resource '${targetFile.id}' (policy: ${POLICY_DISPLAY[targetFile.policy]}) for subject 'user:${userName}' (role: ${gameState.roleDisplay[userRole]})`
    });
    return;
  }

  // AUTHORIZED — Proceed with RAG retrieval & generation
  await delay(800 + Math.random() * 400);

  // Vector search
  const results = searchVectorIndex(query, 4);

  // Generate response
  const response = generateRagResponse(query, targetFile, results, userRole);

  addChatMessage({
    type: 'authorized',
    text: response,
    file: targetFile,
    sources: results
  });
}

function generateRagResponse(query, file, sources, userRole) {
  const prefixes = {
    fremen: 'The desert speaks through the spice... ',
    smuggler: 'Smuggler\'s log indicates... ',
    imperial_spy: 'Imperial records show... '
  };

  if (sources.length === 0) {
    const roleNote = `<br><em>— SpiceDB authorization verified. Relation 'viewer' confirmed on resource '${file.id}' for ${gameState.roleDisplay[userRole]}.</em>`;
    return `${prefixes[userRole] || ''}<strong>No relevant chunks retrieved from the Spice Vault. No relevant information found in the ingested documents.</strong>${roleNote}`;
  }

  let contextSummary = '<strong>Retrieved Context:</strong><br>';
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const preview = (s.text || '').slice(0, 200).replace(/\n/g, ' ');
    contextSummary += `[${i+1}] <em>${s.contentType}</em> — "${escapeHtml(preview)}..."<br>`;
  }
  contextSummary += '<br>';

  let contentDesc = '';
  if (file.isImage) {
    contentDesc = `Visual record analyzed: ${file.name}. ${file.imageDesc}`;
  } else {
    const preview = file.content.slice(0, 800);
    contentDesc = `Archive text recovered: "${escapeHtml(preview)}${file.content.length > 800 ? '...' : ''}"`;
  }

  const roleNote = `<br><em>— SpiceDB authorization verified. Relation 'viewer' confirmed on resource '${file.id}' for ${gameState.roleDisplay[userRole]}.</em>`;

  return `${prefixes[userRole] || ''}${contextSummary}${contentDesc}${roleNote}`;
}

// ============================================================================
// CHAT RENDERING
// ============================================================================

function addChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-message';

  const timestamp = getTimestamp();
  const role = getCurrentUserRole();
  const roleDisplay = gameState.roleDisplay[role];
  const roleClass = `role-${role}`;

  if (msg.type === 'denied') {
    div.classList.add('authorized');
    div.innerHTML = `
      <div class="message-header">
        <span class="message-role ${roleClass}">${roleDisplay}</span>
        <span class="message-time">${timestamp}</span>
      </div>
      <div class="message-content message-denied">
        <svg class="denied-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        ${msg.text}
      </div>
    `;
  } else if (msg.type === 'system') {
    div.innerHTML = `
      <div class="message-header">
        <span class="message-role role-system">SYSTEM</span>
        <span class="message-time">${timestamp}</span>
      </div>
      <div class="message-content" style="border-color: var(--spice-gold); color: var(--spice-gold);">
        ${msg.text}
      </div>
    `;
  } else {
    div.classList.add('authorized');
    let fileHtml = '';
    if (msg.file && msg.file.isImage) {
      fileHtml = `<img src="${msg.file.content}" alt="Ingested image: ${escapeHtml(msg.file.name)}">`;
    }
    div.innerHTML = `
      <div class="message-header">
        <span class="message-role ${roleClass}">${roleDisplay}</span>
        <span class="message-time">${timestamp}</span>
      </div>
      <div class="message-content">
        ${msg.text}
        ${fileHtml}
      </div>
    `;
  }

  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

// ============================================================================
// LOGGING FUNCTIONS (Tuple Store, Auth Log, Audit Log)
// ============================================================================

function logTupleEntry(entry) {
  const div = document.createElement('div');
  div.className = `tuple-entry ${entry.result === 'WRITTEN' ? 'write' : 'check'}`;
  div.innerHTML = `
    <span class="tuple-timestamp">[${getTimestamp()}]</span>
    <span class="tuple-action">${escapeHtml(entry.type)}</span>
    <span class="tuple-resource">resource=${escapeHtml(entry.resource)}</span>
    <span class="tuple-relation">relation=${escapeHtml(entry.relation)}</span>
    <span class="tuple-subject">subject=${escapeHtml(entry.subject)}</span>
    <span class="tuple-result">${escapeHtml(entry.result)}</span>
  `;
  els.tupleLog.appendChild(div);
  els.tupleLog.scrollTop = els.tupleLog.scrollHeight;
}

function logAuthEntry(entry) {
  const div = document.createElement('div');
  const resultClass = entry.result === 'ALLOWED' ? 'allowed' : (entry.result === 'DENIED' ? 'denied' : 'write');
  div.className = `auth-entry ${resultClass}`;

  let detailHtml = '';
  if (entry.type === 'CheckPermission') {
    detailHtml = `<span class="auth-detail">resource_policy=${escapeHtml(entry.policy)} | subject_role=${escapeHtml(entry.role)}</span>`;
  } else if (entry.type === 'WriteTuple') {
    detailHtml = `<span class="auth-detail">tuple=(${escapeHtml(entry.resource)}, ${escapeHtml(entry.relation)}, ${escapeHtml(entry.subject)})</span>`;
  } else if (entry.type === 'IngestComplete') {
    detailHtml = `<span class="auth-detail">file_id=${escapeHtml(entry.fileId || entry.resource?.replace('file:', '') || 'unknown')} | policy=${escapeHtml(entry.policy)}</span>`;
  }

  div.innerHTML = `
    <span class="auth-timestamp">[${getTimestamp()}]</span>
    <span class="auth-action">${escapeHtml(entry.type)}</span>
    <span class="auth-user">user=${escapeHtml(entry.user)}</span>
    <span class="auth-permission">permission=${escapeHtml(entry.permission || 'write')}</span>
    <span class="auth-resource">resource=${escapeHtml(entry.resource)}</span>
    <span class="auth-result ${entry.result.toLowerCase()}">→ ${escapeHtml(entry.result)}</span>
    ${detailHtml}
  `;

  // Remove placeholder if present
  const placeholder = els.authLog.querySelector('.auth-entry:only-child .auth-action');
  if (placeholder && placeholder.textContent === 'SYSTEM') {
    els.authLog.innerHTML = '';
  }

  els.authLog.appendChild(div);
  applyAuthLogFilter();
  els.authLog.scrollTop = els.authLog.scrollHeight;
}

function logAuditEntry(entry) {
  const div = document.createElement('div');
  div.className = `audit-entry ${entry.result === 'ALLOWED' || entry.result === 'SUCCESS' ? 'allowed' : 'denied'}`;

  let detailHtml = '';
  if (entry.type === 'CheckPermission') {
    detailHtml = `<span class="audit-detail">resource_policy=${escapeHtml(entry.policy)} | subject_role=${escapeHtml(getCurrentUserRole())}</span>`;
  } else if (entry.type === 'WriteTuple') {
    detailHtml = `<span class="audit-detail">tuple=(${escapeHtml(entry.resource)}, ${escapeHtml(entry.relation)}, ${escapeHtml(entry.subject)})</span>`;
  } else if (entry.type === 'IngestComplete') {
    detailHtml = `<span class="audit-detail">file_id=${escapeHtml(entry.fileId)} | policy=${escapeHtml(entry.policy)}</span>`;
  } else if (entry.type === 'SystemInit') {
    detailHtml = `<span class="audit-detail">terminal_initialized</span>`;
  }

  div.innerHTML = `
    <span class="audit-timestamp">[${getTimestamp()}]</span>
    <span class="audit-action">${escapeHtml(entry.type)}</span>
    <span class="audit-detail">user=${escapeHtml(entry.user)}</span>
    <span class="audit-detail">permission=${escapeHtml(entry.permission || 'write')}</span>
    <span class="audit-detail">resource=${escapeHtml(entry.resource)}</span>
    <span class="audit-result ${entry.result.toLowerCase()}">→ ${escapeHtml(entry.result)}</span>
    ${detailHtml}
  `;

  els.auditLog.appendChild(div);
  els.auditLog.scrollTop = els.auditLog.scrollHeight;
}

function applyAuthLogFilter() {
  const entries = els.authLog.querySelectorAll('.auth-entry');
  entries.forEach(entry => {
    const show = gameState.authLogFilter === 'all' ||
      (gameState.authLogFilter === 'allowed' && entry.classList.contains('allowed')) ||
      (gameState.authLogFilter === 'denied' && entry.classList.contains('denied'));
    entry.style.display = show ? 'block' : 'none';
  });
}

// ============================================================================
// UI STATE MANAGEMENT
// ============================================================================

function enableQueryPanel() {
  const panel = els.queryPanel;
  if (!panel) {
    console.error('queryPanel element not found');
    return;
  }
  panel.classList.remove('disabled');
  panel.classList.add('power-on');
  panel.style.display = 'flex';
  panel.style.opacity = '1';
  panel.style.pointerEvents = 'auto';
  // Force scroll into view
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => panel.classList.remove('power-on'), 800);
  setTimeout(() => els.queryInput && els.queryInput.focus(), 400);
}

function updateConsultButtonState() {
  const targetFile = gameState.fileLedger[gameState.fileLedger.length - 1];
  if (!targetFile) {
    els.consultBtn.classList.remove('authorized');
    return;
  }
  const authorized = checkSpiceDBPermission(getCurrentUserRole(), targetFile.policy);
  els.consultBtn.classList.toggle('authorized', authorized);
}

// ============================================================================
// TAB SWITCHING
// ============================================================================

function switchTab(tab) {
  const isChat = tab === 'chat';
  els.chatTab.classList.toggle('active', isChat);
  els.auditTab.classList.toggle('active', !isChat);
  els.chatTab.setAttribute('aria-selected', isChat);
  els.auditTab.setAttribute('aria-selected', !isChat);
  els.chatTab.setAttribute('tabindex', isChat ? '0' : '-1');
  els.auditTab.setAttribute('tabindex', !isChat ? '0' : '-1');
  els.chatPanel.classList.toggle('active', isChat);
  els.auditPanel.classList.toggle('active', !isChat);
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function setupEventListeners() {
  // Identity Switcher
  els.identityRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        gameState.currentIdentity = e.target.value;
        updateConsultButtonState();
      }
    });
  });

  // Upload Zone
  els.uploadZone.addEventListener('click', () => els.fileInput.click());
  els.uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach(evt => {
    els.uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.uploadZone.classList.add('drag-active');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    els.uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.uploadZone.classList.remove('drag-active');
    });
  });

  els.uploadZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  });

  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileSelect(file);
  });

  // Ingest Button
  els.ingestBtn.addEventListener('click', async () => {
    await simulateIngestionProgress();
    await completeIngestion();
    updateConsultButtonState();
  });

  // Clear Tuple Log
  els.clearTupleLog.addEventListener('click', () => {
    els.tupleLog.innerHTML = `
      <div class="tuple-entry write">
        <span class="tuple-timestamp">[${getTimestamp()}]</span>
        <span class="tuple-action">LOG CLEARED</span>
        <span class="tuple-detail">Awaiting new ingestion...</span>
      </div>
    `;
  });

  // Query Form
  els.queryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = els.queryInput.value.trim();
    if (!query) return;

    els.consultBtn.disabled = true;
    els.queryInput.disabled = true;

    addChatMessage({
      type: 'system',
      text: `<strong>Query:</strong> ${escapeHtml(query)}`
    });

    await processQuery(query);

    els.consultBtn.disabled = false;
    els.queryInput.disabled = false;
    els.queryInput.value = '';
    els.queryInput.focus();
  });

  // Tab Switching
  els.chatTab.addEventListener('click', () => switchTab('chat'));
  els.auditTab.addEventListener('click', () => switchTab('audit'));
  els.chatTab.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab('chat'); }
  });
  els.auditTab.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab('audit'); }
  });

  // Auth Log Filters
  els.authLogFilters.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      gameState.authLogFilter = filter;
      els.authLogFilters.forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filter);
        b.setAttribute('aria-pressed', b.dataset.filter === filter);
      });
      applyAuthLogFilter();
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function initElements() {
  // Cache all DOM elements
  gameState.elements = {
    uploadZone: els('uploadZone'),
    fileInput: els('fileInput'),
    filePreview: els('filePreview'),
    previewThumb: els('previewThumb'),
    previewName: els('previewName'),
    previewSize: els('previewSize'),
    policySelect: els('policySelect'),
    ingestBtn: els('ingestBtn'),
    progressContainer: els('progressContainer'),
    progressFill: els('progressFill'),
    progressText: els('progressText'),
    tupleLog: els('tupleLog'),
    clearTupleLog: els('clearTupleLog'),
    queryPanel: els('queryPanel'),
    queryForm: els('queryForm'),
    queryInput: els('queryInput'),
    consultBtn: els('consultBtn'),
    chatLog: els('chatLog'),
    chatTab: els('chatTab'),
    auditTab: els('auditTab'),
    chatPanel: els('chatPanel'),
    auditPanel: els('auditPanel'),
    auditLog: els('auditLog'),
    authLog: els('authLog'),
    authLogFilters: document.querySelectorAll('.auth-log-filter-btn'),
    identityRadios: document.querySelectorAll('input[name="identity"]')
  };
  // Assign to global els for backward compat
  Object.assign(els, gameState.elements);
}

function init() {
  initElements();
  setupEventListeners();

  // Initial state
  switchTab('chat');
  applyAuthLogFilter();

  // Welcome audit entry
  logAuditEntry({
    type: 'SystemInit',
    user: 'system',
    resource: 'terminal',
    permission: 'init',
    result: 'READY'
  });

  updateConsultButtonState();

  console.log('%c SpiceDB Arrakis RAG Terminal Initialized ', 'background: #1a140e; color: #00f3ff; font-family: Orbitron; font-size: 14px; padding: 4px 8px; border: 1px solid #00f3ff;');
  console.log('%c Schema: user{}, file{ relation viewer: user, permission view = viewer }', 'color: #c9b896; font-family: monospace;');
  console.log('%c Pipeline: Ingest → Chunk → TF-IDF Index → SpiceDB Check → RAG Query', 'color: #d46b08; font-family: monospace;');
  console.log('%c Try: Upload PDF/TXT/Image → Set Policy → Ingest → Switch Identity → Query', 'color: #d46b08; font-family: monospace;');
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}