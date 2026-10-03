// ============================================
//  OBS Source Switcher
//  WebSocket: obs-websocket-js v5
// ============================================

const obs = new OBSWebSocket();

let isConnected = false;
let currentScene = null;
let activeSourceName = null;
let sourceItems = []; // { sceneItemId, sourceName, sourceKind }
let previewRefreshInterval = null;
let panelVisible = true;

// ============================================
//  TOGGLE PANEL
// ============================================

function togglePanel() {
    const panel = document.getElementById('connection-panel');
    const btn   = document.getElementById('btn-toggle-panel');
    panelVisible = !panelVisible;

    if (panelVisible) {
        panel.classList.remove('collapsed');
        btn.classList.remove('panel-hidden');
        btn.title = 'ซ่อน Connection';
    } else {
        panel.classList.add('collapsed');
        btn.classList.add('panel-hidden');
        btn.title = 'แสดง Connection';
    }
}

// ============================================
//  CONNECTION
// ============================================

async function toggleConnect() {
    if (isConnected) {
        await disconnectOBS();
    } else {
        await connectOBS();
    }
}

async function connectOBS() {
    const host = document.getElementById('ws-host').value.trim() || '127.0.0.1';
    const port = document.getElementById('ws-port').value.trim() || '4455';
    const url = `ws://${host}:${port}`;

    setStatus('connecting');

    try {
        await obs.connect(url);
        setStatus('connected');
        await loadScenes();
    } catch (e) {
        console.error('OBS Connect Error:', e);
        setStatus('disconnected');
    }
}

async function disconnectOBS() {
    try {
        clearPreviewInterval();
        await obs.disconnect();
    } catch (_) {}
    setStatus('disconnected');
    resetUI();
}

// OBS event: disconnected unexpectedly
obs.on('ConnectionClosed', () => {
    setStatus('disconnected');
    resetUI();
});

// ============================================
//  STATUS UI
// ============================================

function setStatus(state) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    const btn = document.getElementById('btn-connect');
    const sceneSelect = document.getElementById('scene-select');
    const btnRefresh = document.getElementById('btn-refresh');

    dot.className = `status-dot ${state}`;

    if (state === 'connected') {
        isConnected = true;
        label.textContent = 'Connected';
        btn.textContent = 'Disconnect';
        btn.classList.add('connected');
        sceneSelect.disabled = false;
        btnRefresh.disabled = false;
    } else if (state === 'connecting') {
        isConnected = false;
        label.textContent = 'Connecting...';
        btn.textContent = 'Cancel';
        btn.classList.remove('connected');
        sceneSelect.disabled = true;
        btnRefresh.disabled = true;
    } else {
        isConnected = false;
        label.textContent = 'Disconnected';
        btn.textContent = 'Connect';
        btn.classList.remove('connected');
        sceneSelect.disabled = true;
        btnRefresh.disabled = true;
    }
}

function resetUI() {
    currentScene = null;
    activeSourceName = null;
    sourceItems = [];

    document.getElementById('scene-select').innerHTML = '<option value="">-- Select Scene --</option>';
    showState('empty');
}

// ============================================
//  SCENES
// ============================================

async function loadScenes() {
    try {
        const { scenes } = await obs.call('GetSceneList');
        const select = document.getElementById('scene-select');
        select.innerHTML = '<option value="">-- Select Scene --</option>';

        // OBS returns scenes in reverse order (last scene first)
        const sorted = [...scenes].reverse();
        sorted.forEach(scene => {
            const opt = document.createElement('option');
            opt.value = scene.sceneName;
            opt.textContent = scene.sceneName;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Load scenes error:', e);
    }
}

async function onSceneChange() {
    const select = document.getElementById('scene-select');
    const sceneName = select.value;

    if (!sceneName) {
        showState('empty');
        return;
    }

    currentScene = sceneName;
    activeSourceName = null;
    await loadSources(sceneName);
}

// ============================================
//  SOURCES
// ============================================

async function loadSources(sceneName) {
    showState('loading');
    clearPreviewInterval();

    try {
        const { sceneItems } = await obs.call('GetSceneItemList', { sceneName });
        sourceItems = sceneItems.map(item => ({
            sceneItemId: item.sceneItemId,
            sourceName: item.sourceName,
            sourceKind: item.inputKind || item.sourceType || 'unknown',
            enabled: item.sceneItemEnabled
        }));

        if (sourceItems.length === 0) {
            showState('empty');
            return;
        }

        showState('grid');
        renderGrid();

        // Load previews asynchronously
        loadAllPreviews();

        // Auto-refresh previews every 5 seconds for video sources
        previewRefreshInterval = setInterval(() => {
            loadAllPreviews();
        }, 5000);

    } catch (e) {
        console.error('Load sources error:', e);
        showState('empty');
    }
}

async function refreshSources() {
    if (!currentScene) return;
    clearPreviewInterval();
    await loadSources(currentScene);
}

// ============================================
//  RENDER GRID
// ============================================

function renderGrid() {
    const grid = document.getElementById('source-grid');
    grid.innerHTML = '';

    sourceItems.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'source-card';
        card.id = `card-${index}`;
        card.setAttribute('data-source', item.sourceName);
        card.setAttribute('data-index', index);

        if (item.enabled && item.sourceName === activeSourceName) {
            card.classList.add('active');
        }

        card.innerHTML = `
            <div class="live-badge">LIVE</div>
            <div class="card-thumb" id="thumb-${index}">
                <div class="card-thumb-placeholder">
                    <span class="placeholder-icon">&#9654;</span>
                    <span class="placeholder-text">Loading...</span>
                </div>
            </div>
            <div class="card-footer">
                <div class="card-name" title="${escapeHtml(item.sourceName)}">${escapeHtml(item.sourceName)}</div>
                <div class="card-type">${formatKind(item.sourceKind)}</div>
            </div>
        `;

        card.addEventListener('click', () => activateSource(index));
        grid.appendChild(card);
    });
}

// ============================================
//  PREVIEW (Screenshot)
// ============================================

async function loadAllPreviews() {
    for (let i = 0; i < sourceItems.length; i++) {
        loadPreview(i);
    }
}

async function loadPreview(index) {
    const item = sourceItems[index];
    const thumbEl = document.getElementById(`thumb-${index}`);
    if (!thumbEl || !isConnected) return;

    try {
        const result = await obs.call('GetSourceScreenshot', {
            sourceName: item.sourceName,
            imageFormat: 'jpeg',
            imageWidth: 320,
            imageHeight: 180,
            imageCompressionQuality: 70
        });

        if (result && result.imageData) {
            thumbEl.innerHTML = `<img src="${result.imageData}" alt="${escapeHtml(item.sourceName)}" loading="lazy">`;
        }
    } catch (e) {
        // Source might not support screenshot (e.g. audio sources)
        thumbEl.innerHTML = `
            <div class="card-thumb-placeholder">
                <span class="placeholder-icon">&#9654;</span>
                <span class="placeholder-text">No Preview</span>
            </div>
        `;
    }
}

// ============================================
//  ACTIVATE / DEACTIVATE SOURCE
// ============================================

async function activateSource(index) {
    if (!isConnected || !currentScene) return;

    const item = sourceItems[index];
    const isSameSource = activeSourceName === item.sourceName;

    try {
        // Deactivate all other sources first
        for (let i = 0; i < sourceItems.length; i++) {
            if (sourceItems[i].sourceName !== item.sourceName) {
                await setSourceVisible(sourceItems[i], false);
                document.getElementById(`card-${i}`)?.classList.remove('active');
                sourceItems[i].enabled = false;
            }
        }

        if (isSameSource) {
            // Toggle off if clicking the same active source
            await setSourceVisible(item, false);
            document.getElementById(`card-${index}`)?.classList.remove('active');
            item.enabled = false;
            activeSourceName = null;
        } else {
            // Activate this source
            await setSourceVisible(item, true);
            document.getElementById(`card-${index}`)?.classList.add('active');
            item.enabled = true;
            activeSourceName = item.sourceName;
        }

    } catch (e) {
        console.error('Activate source error:', e);
    }
}

async function setSourceVisible(item, visible) {
    await obs.call('SetSceneItemEnabled', {
        sceneName: currentScene,
        sceneItemId: item.sceneItemId,
        sceneItemEnabled: visible
    });
}

// ============================================
//  UI STATE
// ============================================

function showState(state) {
    const states = {
        empty: document.getElementById('empty-state'),
        grid: document.getElementById('source-grid'),
        loading: document.getElementById('loading-state')
    };

    Object.entries(states).forEach(([key, el]) => {
        if (key === state) {
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    });
}

// ============================================
//  UTILS
// ============================================

function clearPreviewInterval() {
    if (previewRefreshInterval) {
        clearInterval(previewRefreshInterval);
        previewRefreshInterval = null;
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatKind(kind) {
    if (!kind || kind === 'unknown') return '';
    const map = {
        'ffmpeg_source': 'Media',
        'image_source': 'Image',
        'browser_source': 'Browser',
        'window_capture': 'Window',
        'monitor_capture': 'Display',
        'game_capture': 'Game',
        'text_gdiplus': 'Text (GDI+)',
        'text_ft2_source': 'Text (FT2)',
        'scene': 'Scene',
        'color_source': 'Color',
        'vlc_source': 'VLC',
    };
    return map[kind] || kind.replace(/_/g, ' ');
}


// ============================================
//  QR CODE MODAL
// ============================================

let qrInstance = null;

function showQRModal() {
    const modal = document.getElementById('qr-modal');
    const qrCanvas = document.getElementById('qr-canvas');
    const qrUrlText = document.getElementById('qr-url-text');

    // ดึง URL ปัจจุบัน (ต้องเปิดผ่าน web server ถึงจะใช้งานได้)
    const currentUrl = window.location.href;
    const isFile = currentUrl.startsWith('file://');

    qrUrlText.textContent = isFile ? '⚠️ ต้องเปิดผ่าน Web Server เท่านั้น' : currentUrl;

    // เคลียร์ QR เก่า
    qrCanvas.innerHTML = '';
    qrInstance = null;

    if (!isFile) {
        try {
            qrInstance = new QRCode(qrCanvas, {
                text: currentUrl,
                width: 220,
                height: 220,
                colorDark: '#ffffff',
                colorLight: '#1a1a2e',
                correctLevel: QRCode.CorrectLevel.M
            });
        } catch (e) {
            qrCanvas.innerHTML = '<p style="color:#f55">ไม่สามารถสร้าง QR Code ได้</p>';
        }
    } else {
        qrCanvas.innerHTML = `
            <div style="width:220px;height:220px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;border:2px dashed #444;border-radius:12px;">
                <span style="font-size:2.5rem;">⚠️</span>
                <span style="color:#aaa;font-size:0.8rem;text-align:center;padding:0 16px;">เปิดด้วย Live Server<br>หรือ Web Server ก่อน</span>
            </div>
        `;
    }

    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('visible'), 10);
}

function closeQRModal(event) {
    const modal = document.getElementById('qr-modal');
    if (!event || event.target === modal || event.currentTarget.classList.contains('qr-modal-close')) {
        modal.classList.remove('visible');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
}



