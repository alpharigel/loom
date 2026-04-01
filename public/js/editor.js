// ============================================================
// Editor — CodeMirror 6 (from local bundle) + Markdown preview
// ============================================================

const Editor = {
  view: null,
  currentFile: null,
  isMarkdown: false,
  showPreview: false,

  init() {
    App.on('editor:save', () => this.save());

    document.getElementById('btn-save-file').addEventListener('click', () => this.save());
    document.getElementById('btn-toggle-preview').addEventListener('click', () => this.togglePreview());

    if (!window.CM) {
      console.error('[Editor] CodeMirror bundle not loaded');
    }
  },

  async openFile(filePath) {
    if (!window.CM) {
      App.toast('Editor not available', 'error');
      return;
    }

    try {
      const data = await App.api('GET', `/file?path=${encodeURIComponent(filePath)}`);
      this.currentFile = data;
      this.isMarkdown = ['md', 'markdown', 'mdx'].includes(data.ext);

      document.getElementById('editor-filename').textContent = data.name;
      document.getElementById('btn-save-file').style.display = '';
      document.getElementById('btn-toggle-preview').style.display = this.isMarkdown ? '' : 'none';

      this.createEditor(data.content, data.ext);

      if (this.isMarkdown) {
        this.showPreview = true;
        this.updatePreview(data.content);
        document.getElementById('markdown-preview').style.display = '';
        document.getElementById('editor-container').style.flex = '1';
        document.getElementById('markdown-preview').style.flex = '1';
      } else {
        this.showPreview = false;
        document.getElementById('markdown-preview').style.display = 'none';
        document.getElementById('editor-container').style.flex = '1';
      }
    } catch (err) {
      App.toast('Failed to open file: ' + err.message, 'error');
    }
  },

  createEditor(content, ext) {
    const cm = window.CM;
    const container = document.getElementById('editor-container');

    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
    container.innerHTML = '';

    let lang = [];
    if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) {
      lang = [cm.javascript({ jsx: true, typescript: ext.includes('ts') })];
    } else if (['md', 'markdown', 'mdx'].includes(ext)) {
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

    const self = this;

    this.view = new cm.EditorView({
      state: cm.EditorState.create({
        doc: content,
        extensions: [
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
          cm.EditorView.updateListener.of((update) => {
            if (update.docChanged && self.isMarkdown && self.showPreview) {
              self.updatePreview(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: container,
    });
  },

  togglePreview() {
    if (!this.isMarkdown) return;

    this.showPreview = !this.showPreview;
    const preview = document.getElementById('markdown-preview');

    if (this.showPreview) {
      preview.style.display = '';
      if (this.view) {
        this.updatePreview(this.view.state.doc.toString());
      }
    } else {
      preview.style.display = 'none';
    }
  },

  updatePreview(content) {
    const preview = document.getElementById('markdown-preview');
    if (typeof marked !== 'undefined') {
      preview.innerHTML = marked.parse(content);
    }
  },

  async save() {
    if (!this.currentFile || !this.view) return;

    const content = this.view.state.doc.toString();

    try {
      await App.api('PUT', '/file', {
        path: this.currentFile.path,
        content,
      });
      App.toast('File saved', 'success');
    } catch (err) {
      App.toast('Failed to save: ' + err.message, 'error');
    }
  },
};
