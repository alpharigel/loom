// ============================================================
// Editor — View / Edit tabs, CodeMirror 6, multi-format viewer
// ============================================================

const Editor = {
  view: null,           // CodeMirror EditorView for the Edit pane
  viewerView: null,     // CodeMirror EditorView for the View pane (read-only source)
  currentFile: null,
  currentExt: '',
  currentMode: 'view',  // 'view' | 'edit'
  modeByPath: new Map(),
  savedContent: '',     // last known content on disk (to detect changes)
  saveTimer: null,
  saveInFlight: false,
  saveStatusFadeTimer: null,

  // File-extension classification ----------------------------------------------
  IMAGE_EXTS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'],
  MARKDOWN_EXTS: ['md', 'markdown', 'mdx'],
  HTML_EXTS: ['html', 'htm'],
  PDF_EXTS: ['pdf'],
  // Anything with a CodeMirror language or any plain-text-ish extension is
  // shown as read-only source in the View tab. The full list is open-ended;
  // if `data.content` decodes as utf-8 from the server we treat it as text.
  TEXT_EXTS: [
    'txt', 'log', 'json', 'yml', 'yaml', 'toml', 'ini', 'env', 'csv', 'tsv',
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp',
    'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1',
    'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg',
    'sql', 'gitignore', 'dockerfile', 'makefile', 'lock',
  ],

  init() {
    App.on('editor:save', () => this.save({ immediate: true }));

    document.querySelectorAll('.editor-mode-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });

    if (!window.CM) {
      console.error('[Editor] CodeMirror bundle not loaded');
    }
  },

  classify(ext, name) {
    const e = (ext || '').toLowerCase();
    const n = (name || '').toLowerCase();
    if (this.IMAGE_EXTS.includes(e)) return 'image';
    if (this.MARKDOWN_EXTS.includes(e)) return 'markdown';
    if (this.HTML_EXTS.includes(e)) return 'html';
    if (this.PDF_EXTS.includes(e)) return 'pdf';
    if (this.TEXT_EXTS.includes(e)) return 'text';
    // Common no-extension text files
    if (!e && ['readme', 'license', 'makefile', 'dockerfile'].includes(n)) return 'text';
    return 'unknown';
  },

  isEditable(kind) {
    return kind === 'text' || kind === 'markdown' || kind === 'html';
  },

  async openFile(filePath) {
    if (!window.CM) {
      App.toast('Editor not available', 'error');
      return;
    }

    // Flush any pending save on the previously open file before switching.
    if (this.currentFile && this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.save({ immediate: true });
    }

    try {
      const data = await App.api('GET', `/file?path=${encodeURIComponent(filePath)}`);
      this.currentFile = data;
      this.currentExt = (data.ext || '').toLowerCase();
      this.savedContent = data.content || '';

      document.getElementById('editor-filename').textContent = data.name;

      const kind = this.classify(this.currentExt, data.name);
      const editable = this.isEditable(kind);

      const modeTabs = document.getElementById('editor-mode-tabs');
      modeTabs.style.display = editable ? '' : 'none';

      // Determine initial mode: remembered, or default 'view'.
      const remembered = this.modeByPath.get(data.path);
      const initialMode = editable ? (remembered || 'view') : 'view';
      this.renderView(kind, data);
      this.renderEdit(data, editable);
      this.setMode(initialMode, { skipRender: true });
      this.setSaveStatus('');
    } catch (err) {
      App.toast('Failed to open file: ' + err.message, 'error');
    }
  },

  setMode(mode, opts = {}) {
    if (mode !== 'view' && mode !== 'edit') return;
    this.currentMode = mode;
    if (this.currentFile) {
      this.modeByPath.set(this.currentFile.path, mode);
    }

    document.querySelectorAll('.editor-mode-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const viewPane = document.getElementById('editor-view-pane');
    const editPane = document.getElementById('editor-edit-pane');
    viewPane.style.display = mode === 'view' ? '' : 'none';
    editPane.style.display = mode === 'edit' ? '' : 'none';

    if (mode === 'edit' && this.view) {
      // Give CodeMirror focus when switching to edit.
      setTimeout(() => this.view && this.view.focus(), 0);
    }
  },

  // -- View pane rendering ----------------------------------------------------

  renderView(kind, data) {
    const pane = document.getElementById('editor-view-pane');
    pane.innerHTML = '';
    if (this.viewerView) { this.viewerView.destroy(); this.viewerView = null; }

    const url = `/api/file-content?path=${encodeURIComponent(data.path)}`;

    if (kind === 'image') {
      const wrap = document.createElement('div');
      wrap.className = 'viewer-image-wrap';
      const img = document.createElement('img');
      img.src = url;
      img.alt = data.name;
      wrap.appendChild(img);
      pane.appendChild(wrap);
      return;
    }

    if (kind === 'pdf' || kind === 'html') {
      const iframe = document.createElement('iframe');
      iframe.className = 'viewer-iframe';
      if (kind === 'html') iframe.setAttribute('sandbox', '');
      iframe.src = url;
      pane.appendChild(iframe);
      return;
    }

    if (kind === 'markdown') {
      const div = document.createElement('div');
      div.className = 'markdown-preview';
      div.style.display = '';
      if (typeof marked !== 'undefined') {
        div.innerHTML = marked.parse(data.content || '');
      } else {
        div.textContent = data.content || '';
      }
      pane.appendChild(div);
      return;
    }

    if (kind === 'text') {
      // Read-only CodeMirror, same highlighting as the editor.
      const container = document.createElement('div');
      container.id = 'viewer-cm-container';
      container.style.flex = '1';
      container.style.overflow = 'hidden';
      pane.appendChild(container);
      this.viewerView = this.makeCodeMirror(container, data.content || '', this.currentExt, true);
      return;
    }

    // Unknown / binary — offer to open in default app.
    const wrap = document.createElement('div');
    wrap.className = 'viewer-empty';
    const card = document.createElement('div');
    card.className = 'viewer-empty-card';
    const msg = document.createElement('p');
    const extLabel = this.currentExt ? `.${this.currentExt}` : 'this';
    msg.textContent = `No preview available for ${extLabel} files`;
    const btn = document.createElement('button');
    btn.textContent = 'Open in default app';
    btn.addEventListener('click', async () => {
      try {
        await App.api('POST', '/open-file', { path: data.path });
      } catch (err) {
        App.toast('Failed to open: ' + err.message, 'error');
      }
    });
    card.appendChild(msg);
    card.appendChild(btn);
    wrap.appendChild(card);
    pane.appendChild(wrap);
  },

  // -- Edit pane rendering ----------------------------------------------------

  renderEdit(data, editable) {
    const container = document.getElementById('editor-container');
    if (this.view) { this.view.destroy(); this.view = null; }
    container.innerHTML = '';
    if (!editable) return;
    this.view = this.makeCodeMirror(container, data.content || '', this.currentExt, false);
  },

  makeCodeMirror(container, content, ext, readOnly) {
    const cm = window.CM;
    const self = this;

    let lang = [];
    const e = (ext || '').toLowerCase();
    if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(e)) {
      lang = [cm.javascript({ jsx: true, typescript: e.includes('ts') })];
    } else if (this.MARKDOWN_EXTS.includes(e)) {
      lang = [cm.markdown()];
    }

    const amberTheme = cm.EditorView.theme({
      '&': { backgroundColor: '#121214' },
      '.cm-gutters': {
        backgroundColor: '#1a1a1e',
        borderRight: '1px solid #2a2a30',
        color: '#55555e',
      },
      '.cm-activeLineGutter': { backgroundColor: '#222228' },
      '.cm-activeLine': { backgroundColor: 'rgba(232, 168, 56, 0.04)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'rgba(232, 168, 56, 0.15) !important',
      },
      '.cm-cursor': { borderLeftColor: '#e8a838' },
      '.cm-content': { fontFamily: "'JetBrains Mono', monospace" },
    });

    const extensions = [
      cm.lineNumbers(),
      cm.highlightActiveLineGutter(),
      cm.highlightSpecialChars(),
      cm.history(),
      cm.foldGutter(),
      cm.drawSelection(),
      cm.dropCursor(),
      cm.rectangularSelection(),
      cm.crosshairCursor(),
      cm.highlightActiveLine(),
      cm.highlightSelectionMatches(),
      cm.closeBrackets(),
      cm.autocompletion(),
      cm.indentOnInput(),
      cm.bracketMatching(),
      cm.syntaxHighlighting(cm.defaultHighlightStyle, { fallback: true }),
      cm.keymap.of([
        ...cm.closeBracketsKeymap,
        ...cm.defaultKeymap,
        ...cm.searchKeymap,
        ...cm.historyKeymap,
        ...cm.foldKeymap,
        ...cm.completionKeymap,
        cm.indentWithTab,
      ]),
      ...lang,
      cm.oneDark,
      amberTheme,
    ];

    if (readOnly) {
      extensions.push(cm.EditorState.readOnly.of(true));
      extensions.push(cm.EditorView.editable.of(false));
    } else {
      extensions.push(cm.EditorView.updateListener.of((update) => {
        if (update.docChanged) self.onEdit();
      }));
    }

    return new cm.EditorView({
      state: cm.EditorState.create({ doc: content, extensions }),
      parent: container,
    });
  },

  // -- Auto-save --------------------------------------------------------------

  onEdit() {
    if (!this.view || !this.currentFile) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 500);
  },

  setSaveStatus(text, cls = '') {
    const el = document.getElementById('editor-save-status');
    if (!el) return;
    if (this.saveStatusFadeTimer) {
      clearTimeout(this.saveStatusFadeTimer);
      this.saveStatusFadeTimer = null;
    }
    el.textContent = text;
    el.className = 'editor-save-status' + (cls ? ' ' + cls : '');
    if (text) el.classList.add('visible');
  },

  async save(opts = {}) {
    if (!this.currentFile || !this.view) return;
    if (opts.immediate && this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saveInFlight) return; // a follow-up edit will re-trigger onEdit

    const content = this.view.state.doc.toString();
    if (content === this.savedContent) {
      // No change — avoid touching mtime and noisy "Saved" flashes.
      return;
    }

    this.saveInFlight = true;
    this.setSaveStatus('Saving…');
    try {
      await App.api('PUT', '/file', { path: this.currentFile.path, content });
      this.savedContent = content;
      this.setSaveStatus('Saved', 'saved');
      this.saveStatusFadeTimer = setTimeout(() => this.setSaveStatus(''), 2000);
    } catch (err) {
      this.setSaveStatus('Save failed', 'error');
      console.error('[Editor] save failed:', err);
    } finally {
      this.saveInFlight = false;
      // If the user typed while we were saving, debounce another save.
      if (this.view && this.view.state.doc.toString() !== this.savedContent) {
        this.onEdit();
      }
    }
  },
};
