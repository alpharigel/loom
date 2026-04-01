// ============================================================
// App — State management & WebSocket connection
// ============================================================

const App = {
  state: {
    projectDirectory: '',
    selectedProject: null,   // { name, path, type: 'projects'|'scratch'|'agents'|'skills'|'worktree'|'home', section?, parentProject? }
    projects: [],
    scratch: [],
    agents: [],
    skills: [],
    archived: [],
    view: 'workspace',       // 'dashboard' | 'workspace'
    rightTab: 'files',
    currentFilePath: null,
    dockerEnabled: false,
    profile: null,           // { name, avatar }
    profiles: [],            // all available profiles
    currentHost: localStorage.getItem('loom:currentHost') || '',  // '' = same origin
    peers: [],
    identity: null,
  },

  ws: null,
  listeners: {},

  async init() {
    await this.loadProfile();
    this.connectWebSocket();
    this.setupGlobalKeybindings();
    this.setupDashboardToggle();
    this.setupDrawers();
    this.loadIdentityAndPeers();

    // Poll for changes that the file watcher may miss (worktree ops, external changes)
    setInterval(() => this.emit('fs:changed', { detail: 'poll' }), 5000);
  },

  // ---- Profiles ----

  async loadProfile() {
    // Load available profiles from server
    try {
      this.state.profiles = await this.api('GET', '/profiles');
    } catch { this.state.profiles = []; }

    // Check localStorage for sticky profile
    const savedName = localStorage.getItem('loom:profile');
    if (savedName) {
      const match = this.state.profiles.find(p => p.name === savedName);
      if (match) {
        this.state.profile = match;
        this.renderProfileMenu();
        return;
      }
    }

    if (this.state.profiles.length === 0) {
      // First time — prompt user to create their profile
      this.showCreateFirstProfile();
    } else if (this.state.profiles.length === 1) {
      // Only one profile — just use it
      this.selectProfile(this.state.profiles[0]);
    } else {
      // Multiple profiles, saved one is gone — show picker
      this.showProfilePicker();
    }
    this.renderProfileMenu();
  },

  async createAndSelectProfile(name) {
    if (!name) return;
    try {
      const profile = await this.api('POST', '/profiles', {
        name: name.replace(/[^a-zA-Z0-9_-]/g, ''),
      });
      this.state.profiles = await this.api('GET', '/profiles');
      this.selectProfile(profile);
    } catch (err) {
      console.warn('Failed to create profile:', err);
    }
  },

  showCreateFirstProfile() {
    const overlay = document.getElementById('profile-picker-overlay');
    if (!overlay) return;
    const list = overlay.querySelector('#profile-picker-list');
    list.innerHTML = '<p style="color:var(--text-secondary);font-size:12px;margin-bottom:4px;">Create a profile to get started.</p>';

    const input = overlay.querySelector('#input-new-profile-quick');
    const btn = overlay.querySelector('#btn-create-profile-quick');
    input.value = '';
    input.placeholder = 'Your name';

    // Hide the close button on first-time setup
    const closeBtn = overlay.querySelector('#btn-close-profile-picker');
    if (closeBtn) closeBtn.style.display = 'none';

    const doCreate = () => {
      const name = input.value.trim();
      if (name) {
        this.createAndSelectProfile(name).then(() => {
          overlay.classList.add('hidden');
          if (closeBtn) closeBtn.style.display = '';
          input.placeholder = 'New profile name...';
        });
      }
    };
    btn.onclick = doCreate;
    input.onkeydown = (e) => { if (e.key === 'Enter') doCreate(); };

    overlay.classList.remove('hidden');
    input.focus();
  },

  selectProfile(profile) {
    this.state.profile = profile;
    localStorage.setItem('loom:profile', profile.name);
    this.renderProfileMenu();
    // Refresh projects for the new profile's scratch/agents
    this.emit('profile:changed', profile);
    if (typeof Projects !== 'undefined') Projects.refresh();
  },

  _avatarEmojis: [
    '🐺', '🦊', '🐱', '🐶', '🐻', '🐼', '🐨', '🦁',
    '🐯', '🐸', '🐙', '🦉', '🦅', '🐝', '🦋', '🐳',
    '🚀', '⚡', '🔥', '💎', '🌙', '☀️', '🌊', '🍀',
    '🎯', '🛠️', '⚙️', '🧪', '🔬', '📡', '🎮', '🤖',
  ],

  showProfilePicker() {
    const overlay = document.getElementById('profile-picker-overlay');
    if (!overlay) return;
    const list = overlay.querySelector('#profile-picker-list');
    list.innerHTML = '';

    for (const p of this.state.profiles) {
      const initial = p.name[0].toUpperCase();
      const isActive = this.state.profile?.name === p.name;
      const card = document.createElement('button');
      card.className = `profile-card${isActive ? ' is-active' : ''}`;
      card.innerHTML = `
        <div class="profile-avatar">${p.avatar || initial}</div>
        <div class="profile-card-info">
          <div class="profile-card-name">${this.escHtml(p.name)}</div>
        </div>
      `;
      card.addEventListener('click', () => {
        this.selectProfile(p);
        overlay.classList.add('hidden');
      });
      list.appendChild(card);
    }

    // Quick-create input
    const input = overlay.querySelector('#input-new-profile-quick');
    const btn = overlay.querySelector('#btn-create-profile-quick');
    input.value = '';

    const doCreate = () => {
      const name = input.value.trim();
      if (name) {
        this.createAndSelectProfile(name).then(() => overlay.classList.add('hidden'));
      }
    };
    btn.onclick = doCreate;
    input.onkeydown = (e) => { if (e.key === 'Enter') doCreate(); };

    // Close button
    const closeBtn = overlay.querySelector('#btn-close-profile-picker');
    if (closeBtn) closeBtn.onclick = () => overlay.classList.add('hidden');

    overlay.classList.remove('hidden');
    if (this.state.profiles.length > 0) input.focus();
  },

  renderProfileMenu() {
    const container = document.getElementById('user-menu');
    if (!container) return;

    const profile = this.state.profile;
    if (!profile) {
      container.innerHTML = '';
      return;
    }

    const initial = profile.name[0].toUpperCase();
    const avatarContent = profile.avatar || initial;

    container.innerHTML = `
      <button class="user-menu-btn" id="user-menu-toggle">
        <span class="user-avatar-placeholder">${avatarContent}</span>
      </button>
      <div class="user-dropdown hidden" id="user-dropdown">
        <div class="user-dropdown-header">
          <span class="user-avatar-placeholder">${avatarContent}</span>
          <div>
            <div class="user-dropdown-name">${this.escHtml(profile.name)}</div>
          </div>
        </div>
        <button class="user-dropdown-item" id="btn-switch-profile">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;vertical-align:-2px"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          Switch Profile
        </button>
        <button class="user-dropdown-item" id="btn-manage-profiles">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;vertical-align:-2px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          Manage Profiles
        </button>
      </div>
    `;

    const toggle = document.getElementById('user-menu-toggle');
    const dropdown = document.getElementById('user-dropdown');
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', () => dropdown.classList.add('hidden'));

    document.getElementById('btn-switch-profile').addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.add('hidden');
      this.showProfilePicker();
    });

    document.getElementById('btn-manage-profiles').addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.add('hidden');
      this.showProfileManager();
    });
  },

  showProfileManager() {
    const overlay = document.getElementById('profile-manager-overlay');
    if (!overlay) return;

    const closeBtn = overlay.querySelector('#btn-close-profile-manager');
    if (closeBtn) closeBtn.onclick = () => overlay.classList.add('hidden');

    this._renderProfileManagerList();

    // Add profile form
    const input = overlay.querySelector('#input-new-profile-name');
    const addBtn = overlay.querySelector('#btn-add-profile');
    input.value = '';

    const doAdd = () => {
      const name = input.value.trim();
      if (name) {
        this.createAndSelectProfile(name).then(() => {
          this._renderProfileManagerList();
          input.value = '';
        });
      }
    };
    addBtn.onclick = doAdd;
    input.onkeydown = (e) => { if (e.key === 'Enter') doAdd(); };

    overlay.classList.remove('hidden');
  },

  _renderProfileManagerList() {
    const list = document.getElementById('profile-manager-list');
    if (!list) return;
    list.innerHTML = '';

    for (const p of this.state.profiles) {
      const initial = p.name[0].toUpperCase();
      const row = document.createElement('div');
      row.className = 'profile-manager-row';
      row.innerHTML = `
        <div class="profile-avatar" title="Click to change avatar">${p.avatar || initial}</div>
        <div class="profile-manager-name">
          <span class="profile-display-name" contenteditable="true" spellcheck="false">${this.escHtml(p.name)}</span>
        </div>
        <div class="profile-manager-actions">
          <button class="icon-btn danger" title="Delete profile">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      `;

      // Avatar click — show emoji picker
      const avatarEl = row.querySelector('.profile-avatar');
      avatarEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showAvatarPicker(avatarEl, p);
      });

      // Inline rename
      const nameEl = row.querySelector('.profile-display-name');
      nameEl.addEventListener('blur', () => {
        const newName = nameEl.textContent.trim();
        if (newName && newName !== p.name) {
          this.api('POST', `/profiles/${p.name}/rename`, { newName }).then((updated) => {
            const wasActive = this.state.profile?.name === p.name;
            p.name = updated.name;
            if (wasActive) {
              this.state.profile = updated;
              localStorage.setItem('loom:profile', updated.name);
            }
            this._renderProfileManagerList();
            this.renderProfileMenu();
          }).catch(() => {
            nameEl.textContent = p.name;
          });
        } else {
          nameEl.textContent = p.name;
        }
      });
      nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
        if (e.key === 'Escape') { nameEl.textContent = p.name; nameEl.blur(); }
      });

      // Delete with confirmation
      const deleteBtn = row.querySelector('.icon-btn.danger');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actions = row.querySelector('.profile-manager-actions');
        actions.innerHTML = `
          <div class="profile-delete-confirm">
            <span>Delete?</span>
            <button class="btn btn-danger btn-confirm-delete">Yes</button>
            <button class="btn btn-ghost btn-cancel-delete">No</button>
          </div>
        `;
        actions.style.opacity = '1';
        actions.querySelector('.btn-confirm-delete').addEventListener('click', () => {
          this.api('DELETE', `/profiles/${p.name}`).then(() => {
            this.state.profiles = this.state.profiles.filter(x => x.name !== p.name);
            if (this.state.profile?.name === p.name) {
              const next = this.state.profiles[0];
              if (next) this.selectProfile(next);
            }
            this._renderProfileManagerList();
            this.renderProfileMenu();
          });
        });
        actions.querySelector('.btn-cancel-delete').addEventListener('click', () => {
          this._renderProfileManagerList();
        });
      });

      list.appendChild(row);
    }

    if (this.state.profiles.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:12px;">No profiles yet</div>';
    }
  },

  _showAvatarPicker(anchorEl, profile) {
    // Remove existing picker
    document.querySelectorAll('.avatar-picker-popover').forEach(el => el.remove());

    const picker = document.createElement('div');
    picker.className = 'avatar-picker-popover';

    const grid = document.createElement('div');
    grid.className = 'avatar-picker-grid';

    for (const emoji of this._avatarEmojis) {
      const btn = document.createElement('button');
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        this.api('POST', '/profiles', { name: profile.name, avatar: emoji }).then(() => {
          profile.avatar = emoji;
          anchorEl.textContent = emoji;
          this.renderProfileMenu();
          picker.remove();
        });
      });
      grid.appendChild(btn);
    }

    const resetBtn = document.createElement('button');
    resetBtn.className = 'avatar-picker-reset';
    resetBtn.textContent = 'Use initial';
    resetBtn.addEventListener('click', () => {
      this.api('POST', '/profiles', { name: profile.name, avatar: null }).then(() => {
        profile.avatar = null;
        anchorEl.textContent = profile.name[0].toUpperCase();
        this.renderProfileMenu();
        picker.remove();
      });
    });

    picker.appendChild(grid);
    picker.appendChild(resetBtn);
    document.body.appendChild(picker);

    // Position near the anchor
    const rect = anchorEl.getBoundingClientRect();
    picker.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
    picker.style.top = (rect.bottom + 6) + 'px';

    // Close on outside click
    const closeHandler = (e) => {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  },

  // ---- WebSocket ----

  _wsConnectedOnce: false,

  connectWebSocket() {
    this.setConnStatus('connecting');
    let wsUrl;
    if (this.state.currentHost) {
      const url = new URL(this.state.currentHost);
      const proto = url.protocol === 'https:' ? 'wss' : 'ws';
      wsUrl = `${proto}://${url.host}`;
    } else {
      const base = new URL(document.baseURI);
      const proto = base.protocol === 'https:' ? 'wss' : 'ws';
      wsUrl = `${proto}://${base.host}${base.pathname.replace(/\/$/, '')}`;
    }
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.setConnStatus('connected');
      if (this._wsConnectedOnce) {
        this.emit('ws:reconnected');
      }
      this._wsConnectedOnce = true;
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      // Dev live-reload: refresh page when frontend files change
      if (msg.type === 'dev:reload') {
        console.log('[WS] Dev reload triggered');
        location.reload();
        return;
      }

      this.emit(msg.type, msg);
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 2s...');
      this.setConnStatus('disconnected');
      setTimeout(() => this.connectWebSocket(), 2000);
    };

    this.ws.onerror = () => {
      this.setConnStatus('disconnected');
    };
  },

  setConnStatus(status) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.className = 'conn-status ' + status;
    el.title = status.charAt(0).toUpperCase() + status.slice(1);
    el.querySelector('.conn-label').textContent = status;
  },

  wsSend(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  },

  // ---- Event bus ----

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  },

  emit(event, data) {
    (this.listeners[event] || []).forEach(fn => fn(data));
  },

  // ---- Machine switching ----

  async loadIdentityAndPeers() {
    try {
      this.state.identity = await this.api('GET', '/identity');
    } catch { /* ignore */ }
    this.renderMachineSwitcher();
    // Refresh peers periodically
    this.discoverPeers();
    setInterval(() => this.discoverPeers(), 30000);
  },

  async discoverPeers() {
    try {
      const data = await this.api('GET', '/peers');
      this.state.peers = data.peers || [];
      this.renderMachineSwitcher();
    } catch { /* ignore */ }
  },

  async switchMachine(hostUrl) {
    this.state.currentHost = hostUrl;
    if (hostUrl) {
      localStorage.setItem('loom:currentHost', hostUrl);
    } else {
      localStorage.removeItem('loom:currentHost');
    }

    // Ensure our profile exists on the remote machine
    if (hostUrl && this.state.profile) {
      try {
        await this.api('POST', '/profiles/ensure', { name: this.state.profile.name });
      } catch { /* ignore — profile will work without it */ }
    }

    // Close existing WS
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this._wsConnectedOnce = false;
    this.connectWebSocket();
    // Clear selection and refresh
    this.selectProject(null);
    Projects.refresh();
    this.loadIdentityAndPeers();
  },

  renderMachineSwitcher() {
    const container = document.getElementById('machine-switcher');
    if (!container) return;

    const identity = this.state.identity;
    const currentName = identity ? identity.hostname : 'Local';
    const currentPort = identity ? identity.port : '';
    const peers = this.state.peers || [];

    const osLabels = { darwin: 'Mac', linux: 'Linux', win32: 'Windows' };

    container.innerHTML = `
      <button class="machine-switcher-btn pane-title" id="machine-toggle" title="Switch machine">
        <span>Workspace: ${this.escHtml(currentName)}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="machine-dropdown hidden" id="machine-dropdown">
        <div class="machine-dropdown-label">Machines</div>
        <div class="machine-option active" data-host="">
          <svg class="machine-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <strong>${this.escHtml(currentName)}</strong>
          <span class="machine-port">:${currentPort}</span>
          <span class="machine-meta">${osLabels[identity?.os] || ''}</span>
          <span class="machine-current-badge">current</span>
        </div>
        ${peers.filter(p => p.name !== `Loom-${identity?.hostname}-${identity?.port}`).map(p => {
          const addr = (p.addresses || []).find(a => !a.includes(':')) || p.host;
          const hostUrl = `http://${addr}:${p.port}`;
          const peerOs = osLabels[p.txt?.os] || '';
          return `<div class="machine-option" data-host="${this.escHtml(hostUrl)}">
            <svg class="machine-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            <strong>${this.escHtml(p.txt?.hostname || p.name)}</strong>
            <span class="machine-port">:${p.port}</span>
            <span class="machine-meta">${peerOs}</span>
          </div>`;
        }).join('')}
        ${peers.length === 0 ? '<div class="machine-empty">Searching for other machines...</div>' : ''}
      </div>
    `;

    const toggle = document.getElementById('machine-toggle');
    const dropdown = document.getElementById('machine-dropdown');

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });

    dropdown.querySelectorAll('.machine-option[data-host]').forEach(opt => {
      opt.addEventListener('click', () => {
        const host = opt.dataset.host;
        dropdown.classList.add('hidden');
        if (host !== (this.state.currentHost || '')) {
          this.switchMachine(host);
        }
      });
    });

    document.addEventListener('click', () => dropdown.classList.add('hidden'));
  },

  escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  },

  // ---- Selection ----

  selectProject(project) {
    this.state.selectedProject = project;
    if (project && this.state.view === 'dashboard') {
      this.setView('workspace');
    }

    // Persist selection for page reload
    if (project) {
      localStorage.setItem('loom:selectedProject', JSON.stringify(project));
    } else {
      localStorage.removeItem('loom:selectedProject');
    }

    this.emit('project:selected', project);

    // Update context badge
    const badge = document.getElementById('current-context');
    if (project) {
      const label = project.type === 'worktree'
        ? `${project.parentProject} / ${project.name}`
        : project.name;
      badge.textContent = label;
      badge.style.borderColor = 'var(--accent-dim)';
    } else {
      badge.textContent = 'No project selected';
      badge.style.borderColor = 'transparent';
    }
  },

  // ---- API helpers ----

  async api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    // Send active profile name with every API request
    if (this.state.profile) {
      opts.headers['X-Loom-Profile'] = this.state.profile.name;
    }
    if (body) opts.body = JSON.stringify(body);
    const base = this.state.currentHost || '';
    const prefix = base || document.baseURI.replace(/\/$/, '');
    const res = await fetch(`${prefix}/api${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  },

  // ---- Toast ----

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.style.animation = 'fadeOut 200ms ease forwards';
      setTimeout(() => el.remove(), 200);
    }, 3000);
  },

  // ---- Keybindings ----

  setupGlobalKeybindings() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+S / Cmd+S: save file
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.emit('editor:save');
      }
    });
  },

  // ---- View switching ----

  setView(view) {
    this.state.view = view;
    const dashboard = document.getElementById('dashboard-view');
    const workspace = document.getElementById('workspace');

    if (view === 'dashboard') {
      dashboard.style.display = '';
      workspace.style.display = 'none';
      document.getElementById('btn-dashboard').classList.add('active');
    } else {
      dashboard.style.display = 'none';
      workspace.style.display = '';
      document.getElementById('btn-dashboard').classList.remove('active');
      setTimeout(() => TerminalManager.fitAll(), 50);
    }

    this.emit('view:changed', view);
  },

  setupDashboardToggle() {
    document.getElementById('btn-dashboard').addEventListener('click', () => {
      this.setView(this.state.view === 'dashboard' ? 'workspace' : 'dashboard');
    });
  },

  setupDrawers() {
    const leftPane = document.getElementById('left-pane');
    const rightPane = document.getElementById('right-pane');
    const overlay = document.getElementById('drawer-overlay');
    const btnLeft = document.getElementById('btn-toggle-left');
    const btnRight = document.getElementById('btn-toggle-right');

    const closeAll = () => {
      leftPane.classList.remove('drawer-open');
      rightPane.classList.remove('drawer-open');
      overlay.classList.remove('visible');
    };

    btnLeft.addEventListener('click', () => {
      const opening = !leftPane.classList.contains('drawer-open');
      closeAll();
      if (opening) {
        leftPane.classList.add('drawer-open');
        overlay.classList.add('visible');
      }
    });

    btnRight.addEventListener('click', () => {
      const opening = !rightPane.classList.contains('drawer-open');
      closeAll();
      if (opening) {
        rightPane.classList.add('drawer-open');
        overlay.classList.add('visible');
      }
    });

    overlay.addEventListener('click', closeAll);

    // Close drawer when a project is selected (mobile)
    this.on('project:selected', () => {
      if (window.innerWidth <= 768) closeAll();
    });
  },

  // ---- Panel Resize ----

  setupPanelResize() {
    const handles = document.querySelectorAll('.resize-handle');
    const workspace = document.getElementById('workspace');
    const leftPane = document.getElementById('left-pane');
    const rightPane = document.getElementById('right-pane');

    let activeHandle = null;
    let startX = 0;
    let startWidth = 0;

    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        activeHandle = handle.dataset.resize;
        startX = e.clientX;
        startWidth = activeHandle === 'left'
          ? leftPane.offsetWidth
          : rightPane.offsetWidth;
        handle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!activeHandle) return;
      const dx = e.clientX - startX;

      if (activeHandle === 'left') {
        const newWidth = Math.max(200, Math.min(400, startWidth + dx));
        leftPane.style.width = newWidth + 'px';
      } else {
        const newWidth = Math.max(250, Math.min(500, startWidth - dx));
        rightPane.style.width = newWidth + 'px';
      }

      // Refit terminals
      TerminalManager.fitAll();
    });

    document.addEventListener('mouseup', () => {
      if (activeHandle) {
        document.querySelectorAll('.resize-handle').forEach(h => h.classList.remove('active'));
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        activeHandle = null;
        TerminalManager.fitAll();
      }
    });
  },
};

// Boot
document.addEventListener('DOMContentLoaded', async () => {
  await App.init();
  Settings.init();
  Projects.init();
  TerminalManager.init();
  FileBrowser.init();
  Editor.init();
  Details.init();
  Dashboard.init();
  App.setupPanelResize();

  // Dashboard loads lazily when toggled
});
