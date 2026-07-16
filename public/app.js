// app.js - Multi-Modal RAG Frontend (Vercel API Integration)
// Dune/SpiceDB themed - Communicates with Vercel Serverless Functions

const gameState = {
  currentIdentity: 'paul',
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
  pendingFile: null,
  fileLedger: [],
  authLogFilter: 'all',
  elements: {}
};

const POLICY_DISPLAY = {
  public: 'Public — Open to all',
  sietch_secret: 'Sietch Secret — Fremen only',
  imperial_classified: 'Imperial Classified — No access'
};

const ROLE_PREFIXES = {
  fremen: 'The desert speaks through the spice... ',
  smuggler: "Smuggler's log indicates... ",
  imperial_spy: 'Imperial records show... '
};

const els = (id) => document.getElementById(id);

function getTimestamp() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({'&':'&','<':'<','>':'>','"':'"',"'":'''}[s]));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(2)} MB`;
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

function initElements() {
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
  Object.assign(els, gameState.elements);
}

function setupEventListeners() {
  els.identityRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        gameState.currentIdentity = e.target.value;
        updateConsultButtonState();
      }
    });
  });

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

  els.ingestBtn.addEventListener('click', async () => {
    await ingestFile();
  });

  els.clearTupleLog.addEventListener('click', () => {
    els.tupleLog.innerHTML = `
      <div class="tuple-entry write">
        <span class="tuple-timestamp">[${getTimestamp()}]</span>
        <span class="tuple-action">LOG CLEARED</span>
        <span class="tuple-detail">Awaiting new ingestion...</span>
      </div>
    `;
  });

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

  els.chatTab.addEventListener('click', () => switchTab('chat'));
  els.auditTab.addEventListener('click', () => switchTab('audit'));
  els.chatTab.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab('chat'); }
  });
  els.auditTab.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab('audit'); }
  });

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

async function handleFileSelect(file) {
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

async function ingestFile() {
  const file = gameState.pendingFile;
  const policy = els.policySelect.value;
  const identity = gameState.currentIdentity;

  if (!file) return;

  els.progressContainer.hidden = false;
  els.progressContainer.classList.add('visible');
  els.ingestBtn.disabled = true;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('policy', policy);
  formData.append('identity', identity);

  const steps = [
    { progress: 10, text: 'The spice must flow... parsing document structure...' },
    { progress: 25, text: 'Extracting text, tables, and figures...' },
    { progress: 45, text: 'Chunking by markdown headers — structural segmentation...' },
    { progress: 60, text: 'Computing embeddings for vector index...' },
    { progress: 75, text: 'Analyzing visual elements with Gemini Vision...' },
    { progress: 90, text: 'Writing tuples to SpiceDB ledger — establishing viewer relations...' },
    { progress: 100, text: 'Ingestion complete. The archives remember.' }
  ];

  for (const step of steps) {
    els.progressFill.style.width = step.progress + '%';
    els.progressText.textContent = step.text;
    await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
  }

  try {
    const response = await fetch('/api/ingest', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Ingestion failed');
    }

    await new Promise(r => setTimeout(r, 400));
    els.progressContainer.classList.remove('visible');
    els.progressContainer.hidden = true;
    els.progressFill.style.width = '0%';

    gameState.pendingFile = null;
    els.filePreview.classList.remove('visible');
    els.previewThumb.src = '';
    els.previewThumb.hidden = true;
    els.fileInput.value = '';
    els.policySelect.value = 'public';
    els.ingestBtn.disabled = true;
    els.uploadZone.classList.remove('has-file');

    enableQueryPanel();

    logTupleEntry({
      type: 'WriteTuple',
      user: getCurrentUserName(),
      resource: `file:${result.fileId}`,
      relation: 'policy',
      subject: `policy:${policy}`,
      result: 'WRITTEN'
    });

    logTupleEntry({
      type: 'WriteTuple',
      user: getCurrentUserName(),
      resource: `file:${result.fileId}`,
      relation: 'content',
      subject: `data:${file.type}`,
      result: 'WRITTEN'
    });

    logTupleEntry({
      type: 'WriteTuple',
      user: getCurrentUserName(),
      resource: `file:${result.fileId}`,
      relation: 'chunks',
      subject: `count:${result.chunksCreated}`,
      result: 'WRITTEN'
    });

    logAuthEntry({
      type: 'WriteTuple', user: getCurrentUserName(), resource: `file:${result.fileId}`,
      relation: 'policy', subject: `policy:${policy}`, permission: 'write', result: 'WRITTEN'
    });
    logAuthEntry({
      type: 'WriteTuple', user: getCurrentUserName(), resource: `file:${result.fileId}`,
      relation: 'content', subject: `data:${file.type}`, permission: 'write', result: 'WRITTEN'
    });
    logAuthEntry({
      type: 'IngestComplete', user: getCurrentUserName(), resource: `file:${result.fileId}`,
      policy: policy, result: 'SUCCESS', fileId: result.fileId
    });

    logAuditEntry({
      type: 'IngestComplete', user: getCurrentUserName(), resource: `file:${result.fileId}`,
      policy: policy, result: 'SUCCESS'
    });

    addChatMessage({
      type: 'system',
      text: `File <strong>${escapeHtml(file.name)}</strong> ingested with policy <strong>${POLICY_DISPLAY[policy]}</strong>. ${result.chunksCreated} chunks indexed. Tuples written to SpiceDB.`
    });

    updateConsultButtonState();

  } catch (error) {
    els.progressContainer.classList.remove('visible');
    els.progressContainer.hidden = true;
    els.progressFill.style.width = '0%';
    els.ingestBtn.disabled = false;
    
    addChatMessage({
      type: 'denied',
      text: `INGESTION FAILED: ${escapeHtml(error.message)}`
    });
  }
}

async function processQuery(query) {
  const identity = gameState.currentIdentity;
  
  try {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, identity })
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 403) {
        addChatMessage({
          type: 'denied',
          text: data.message || 'ACCESS DENIED BY SPICEDB'
        });
        logAuthEntry({
          type: 'CheckPermission',
          user: getCurrentUserName(),
          resource: data.fileId || 'unknown',
          relation: 'viewer',
          subject: `user:${getCurrentUserName()}`,
          permission: 'view',
          result: 'DENIED',
          policy: data.policy,
          role: getCurrentUserRole()
        });
        return;
      }
      throw new Error(data.error || 'Query failed');
    }

    logAuthEntry({
      type: 'CheckPermission',
      user: getCurrentUserName(),
      resource: data.fileId || 'unknown',
      relation: 'viewer',
      subject: `user:${getCurrentUserName()}`,
      permission: 'view',
      result: 'ALLOWED',
      policy: data.policy,
      role: getCurrentUserRole()
    });

    logAuditEntry({
      type: 'CheckPermission',
      user: getCurrentUserName(),
      resource: data.fileId || 'unknown',
      policy: data.policy,
      result: 'ALLOWED'
    });

    addChatMessage({
      type: 'authorized',
      text: data.answer,
      sources: data.sources,
      fileId: data.fileId
    });

  } catch (error) {
    console.error('Query error:', error);
    addChatMessage({
      type: 'denied',
      text: `ORACLE ERROR: ${escapeHtml(error.message)}`
    });
  }
}

function checkPermission(userRole, filePolicy) {
  switch (filePolicy) {
    case 'public': return true;
    case 'sietch_secret': return userRole === 'fremen';
    case 'imperial_classified': return userRole === 'imperial_spy';
    default: return false;
  }
}

function updateConsultButtonState() {
  const authorized = checkPermission(getCurrentUserRole(), 'public');
  els.consultBtn.classList.toggle('authorized', authorized);
}

function enableQueryPanel() {
  const panel = els.queryPanel;
  if (!panel) return;
  panel.classList.remove('disabled');
  panel.classList.add('power-on');
  panel.style.display = 'flex';
  panel.style.opacity = '1';
  panel.style.pointerEvents = 'auto';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => panel.classList.remove('power-on'), 800);
  setTimeout(() => els.queryInput && els.queryInput.focus(), 400);
}

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
    let sourcesHtml = '';
    if (msg.sources && msg.sources.length > 0) {
      sourcesHtml = '<strong>Sources:</strong><br>';
      msg.sources.forEach((s, i) => {
        const preview = (s.text || '').slice(0, 150).replace(/\n/g, ' ');
        sourcesHtml += `[${i+1}] <em>${s.contentType || 'text'}</em> — "${escapeHtml(preview)}..."<br>`;
      });
    }
    div.innerHTML = `
      <div class="message-header">
        <span class="message-role ${roleClass}">${roleDisplay}</span>
        <span class="message-time">${timestamp}</span>
      </div>
      <div class="message-content">
        ${msg.text}
        ${sourcesHtml ? `<br>${sourcesHtml}` : ''}
        <br><em>— SpiceDB authorization verified. Relation 'viewer' confirmed for ${gameState.roleDisplay[role]}.</em>
      </div>
    `;
  }

  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

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

function init() {
  initElements();
  setupEventListeners();

  switchTab('chat');
  applyAuthLogFilter();

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
  console.log('%c Pipeline: Ingest → Chunk → Embed → Upstash Vector Index → SpiceDB Check → RAG Query', 'color: #d46b08; font-family: monospace;');
  console.log('%c Try: Upload PDF/TXT/Image → Set Policy → Ingest → Switch Identity → Query', 'color: #d46b08; font-family: monospace;');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}