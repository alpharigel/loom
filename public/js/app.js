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
    profile: null,           // { name, displayName, avatar }
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

    // No saved profile or it no longer exists — show picker if profiles exist
    if (this.state.profiles.length > 0) {
      this.showProfilePicker();
    } else {
      // No profiles at all — create a default one from OS username
      await this.createAndSelectProfile(null);
    }
    this.renderProfileMenu();
  },

  async createAndSelectProfile(name) {
    const profileName = name || this.state.identity?.user || 'default';
    try {
      const profile = await this.api('POST', '/profiles', {
        name: profileName.replace(/[^a-zA-Z0-9_-]/g, ''),
        displayName: profileName,
      });
      this.state.profiles = await this.api('GET', '/profiles');
      this.selectProfile(profile);
    } catch (err) {
      console.warn('Failed to create profile:', err);
    }
  },

  selectProfile(profile) {
    this.state.profile = profile;
    localStorage.setItem('loom:profile', profile.name);
    this.renderProfileMenu();
    // Refresh projects for the new profile's scratch/agents
    this.emit('profile:changed', profile);
    if (typeof Projects !== 'undefined') Projects.refresh();
  },

  showProfilePicker() {
    const overlay = document.getElementById('profile-picker-overlay');
    if (!overlay) return;
    const list = overlay.querySelector('#profile-picker-list');
    list.innerHTML = '';

    for (const p of this.state.profiles) {
      const btn = document.createElement('button');
      btn.className = 'profile-picker-btn';
      const initial = (p.displayName || p.name)[0].toUpperCase();
      btn.innerHTML = `
        <span class="profile-avatar-circle">${p.avatar || initial}</span>
        <span>${this.escHtml(p.displayName || p.name)}</span>
      `;
      btn.addEventListener('click', () => {
        this.selectProfile(p);
        overlay.classList.add('hidden');
      });
      list.appendChild(btn);
    }

    // Add "create new" option
    const createBtn = document.createElement('button');
    createBtn.className = 'profile-picker-btn profile-picker-create';
    createBtn.innerHTML = `<span class="profile-avatar-circle">+</span><span>New profile...</span>`;
    createBtn.addEventListener('click', () => {
      const name = prompt('Profile name:');
      if (name) {
        this.createAndSelectProfile(name).then(() => overlay.classList.add('hidden'));
      }
    });
    list.appendChild(createBtn);

    overlay.classList.remove('hidden');
  },

  renderProfileMenu() {
    const container = document.getElementById('user-menu');
    if (!container) return;

    const profile = this.state.profile;
    if (!profile) {
      container.innerHTML = '';
      return;
    }

    const initial = (profile.displayName || profile.name)[0].toUpperCase();
    const avatarHtml = profile.avatar
      ? `<span class="user-avatar-placeholder">${profile.avatar}</span>`
      : `<span class="user-avatar-placeholder">${initial}</span>`;

    container.innerHTML = `
      <button class="user-menu-btn" id="user-menu-toggle">
        ${avatarHtml}
      </button>
      <div class="user-dropdown hidden" id="user-dropdown">
        <div class="user-dropdown-header">
          ${avatarHtml}
          <div>
            <div class="user-dropdown-name">${this.escHtml(profile.displayName || profile.name)}</div>
          </div>
        </div>
        <button class="user-dropdown-item" id="btn-switch-profile">Switch Profile</button>
        <button class="user-dropdown-item" id="btn-manage-profiles">Manage Profiles</button>
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
    // Simple prompt-based management for now — can be upgraded to a modal later
    const profiles = this.state.profiles;
    const names = profiles.map(p => p.displayName || p.name).join(', ');
    const action = prompt(`Profiles: ${names}\n\nType a command:\n- "add <name>" to create\n- "remove <name>" to delete\n- "rename <old> <new>" to rename`);
    if (!action) return;

    const parts = action.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === 'add' && parts[1]) {
      this.createAndSelectProfile(parts.slice(1).join(' '));
    } else if (cmd === 'remove' && parts[1]) {
      const name = parts.slice(1).join(' ');
      const match = profiles.find(p => p.name === name || p.displayName === name);
      if (match) {
        this.api('DELETE', `/profiles/${match.name}`).then(() => this.loadProfile());
      }
    } else if (cmd === 'rename' && parts[1] && parts[2]) {
      const match = profiles.find(p => p.name === parts[1] || p.displayName === parts[1]);
      if (match) {
        this.api('POST', '/profiles', { name: match.name, displayName: parts.slice(2).join(' ') })
          .then(() => this.loadProfile());
      }
    }
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
