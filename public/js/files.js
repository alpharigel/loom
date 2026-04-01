// ============================================================
// File Browser — Right pane file listing
// ============================================================

const FileBrowser = {
  currentPath: null,
  _lastFingerprint: null,

  init() {
    App.on('project:selected', (project) => {
      this._lastFingerprint = null;
      if (project) {
        this.navigate(project.path);
      } else {
        this.clear();
      }
    });

    // Listen for file system changes
    App.on('fs:changed', (msg) => {
      if (this.currentPath) {
        this.navigate(this.currentPath);
      }
    });
  },

  async navigate(dirPath, force) {
    this.currentPath = dirPath;
    App.state.currentFilePath = dirPath;

    try {
      const data = await App.api('GET', `/files?path=${encodeURIComponent(dirPath)}`);
      const fingerprint = JSON.stringify(data.files.map(f => f.name + (f.size || '')));
      if (!force && fingerprint === this._lastFingerprint) return;
      this._lastFingerprint = fingerprint;
      this.renderBreadcrumbs(data.path);
      this.renderFiles(data.files);
    } catch (err) {
      App.toast('Failed to load files: ' + err.message, 'error');
    }
  },

  renderBreadcrumbs(fullPath) {
    const container = document.getElementById('file-breadcrumbs');
    container.innerHTML = '';

    const sel = App.state.selectedProject;
    if (!sel) return;

    const basePath = sel.path;
    const relative = fullPath.startsWith(basePath)
      ? fullPath.slice(basePath.length)
      : fullPath;

    const crumbsWrap = document.createElement('span');
    crumbsWrap.className = 'breadcrumb-path';

    // Root breadcrumb
    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'breadcrumb';
    rootCrumb.textContent = sel.name;
    rootCrumb.addEventListener('click', () => this.navigate(basePath));
    crumbsWrap.appendChild(rootCrumb);

    // Sub-path breadcrumbs
    if (relative) {
      const parts = relative.split('/').filter(Boolean);
      let accumulated = basePath;
      for (const part of parts) {
        accumulated = accumulated + '/' + part;

        const sep = document.createElement('span');
        sep.className = 'breadcrumb-sep';
        sep.textContent = '/';
        crumbsWrap.appendChild(sep);

        const crumb = document.createElement('span');
        crumb.className = 'breadcrumb';
        crumb.textContent = part;
        const target = accumulated;
        crumb.addEventListener('click', () => this.navigate(target));
        crumbsWrap.appendChild(crumb);
      }
    }

    container.appendChild(crumbsWrap);

    // Add file/folder button
    const addBtn = document.createElement('button');
    addBtn.className = 'breadcrumb-add-btn';
    addBtn.title = 'New file or folder';
    addBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showNewItemMenu(addBtn);
    });
    container.appendChild(addBtn);
  },

  showNewItemMenu(anchor) {
    // Remove any existing menu
    document.querySelector('.file-new-menu')?.remove();

    const menu = document.createElement('div');
    menu.className = 'file-new-menu';
    menu.innerHTML = `
      <button class="file-new-option" data-type="file">New file</button>
      <button class="file-new-option" data-type="folder">New folder</button>
    `;

    menu.querySelector('[data-type="file"]').addEventListener('click', () => {
      menu.remove();
      this.promptNewItem('file');
    });
    menu.querySelector('[data-type="folder"]').addEventListener('click', () => {
      menu.remove();
      this.promptNewItem('folder');
    });

    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    // Close on click outside
    const close = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  },

  promptNewItem(type) {
    const name = prompt(`${type === 'file' ? 'File' : 'Folder'} name:`);
    if (!name || !name.trim()) return;
    this.createNewItem(name.trim(), type);
  },

  async createNewItem(name, type) {
    const dir = this.currentPath;
    if (!dir) return;

    const fullPath = dir + '/' + name;
    try {
      if (type === 'folder') {
        await App.api('POST', '/files/mkdir', { path: fullPath });
      } else {
        await App.api('PUT', '/file', { path: fullPath, content: '' });
      }
      this.navigate(dir);
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  renderFiles(files) {
    const list = document.getElementById('file-list');
    list.innerHTML = '';

    if (files.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⊘</div>
          <p>Empty directory</p>
        </div>
      `;
      return;
    }

    // Parent directory link
    if (this.currentPath !== App.state.selectedProject?.path) {
      const parentEl = document.createElement('div');
      parentEl.className = 'file-item directory';
      parentEl.innerHTML = `
        <span class="file-icon">↩</span>
        <span class="file-name">..</span>
      `;
      const parentPath = this.currentPath.split('/').slice(0, -1).join('/');
      parentEl.addEventListener('click', () => this.navigate(parentPath));
      list.appendChild(parentEl);
    }

    for (const file of files) {
      const el = document.createElement('div');
      el.className = `file-item ${file.isDirectory ? 'directory' : ''} ${file.isHidden ? 'hidden-file' : ''}`;

      const icon = file.isDirectory ? '▸' : this.getFileIcon(file.name);
      const size = file.isDirectory ? '' : this.formatSize(file.size);

      el.innerHTML = `
        <span class="file-icon">${icon}</span>
        <span class="file-name">${this.esc(file.name)}</span>
        ${size ? `<span class="file-size">${size}</span>` : ''}
      `;

      el.addEventListener('click', () => {
        if (file.isDirectory) {
          this.navigate(file.path);
        } else {
          this.openFile(file.path);
        }
      });

      list.appendChild(el);
    }
  },

  openFile(filePath) {
    // Switch to editor tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="editor"]').classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-editor').classList.add('active');
    App.state.rightTab = 'editor';

    Editor.openFile(filePath);
  },

  clear() {
    this.currentPath = null;
    document.getElementById('file-breadcrumbs').innerHTML = '';
    document.getElementById('file-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◇</div>
        <p>Select a project to browse files</p>
      </div>
    `;
  },

  getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
      md: '◈', js: '◉', ts: '◉', py: '◉', rb: '◉', go: '◉',
      json: '{}', yaml: '{}', yml: '{}', toml: '{}',
      html: '◈', css: '◈', scss: '◈',
      png: '◑', jpg: '◑', jpeg: '◑', gif: '◑', svg: '◑',
      sh: '▸', bash: '▸', zsh: '▸',
      lock: '◎', gitignore: '◎',
    };
    return icons[ext] || '◻';
  },

  formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};
