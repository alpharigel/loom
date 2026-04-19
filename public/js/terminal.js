// ============================================================
// Terminal Manager — xterm.js + WebSocket PTY multiplexing
// Sessions persist when switching projects (30-min idle TTL)
// ============================================================

const TerminalManager = {
  terminals: new Map(),      // id -> { term, fitAddon, wrapperEl, cwd, cmd, lastActive }
  sessionsByPath: new Map(), // projectPath -> { mainId, rightId }
  agentStatus: new Map(),    // projectPath -> status string ('working'|'waiting'|'done'|'error')
  counter: 0,
  mainTermId: null,
  rightTermId: null,
  currentPath: null,  // track which project path is active (separate from App.state)

  SESSION_TTL: 30 * 60 * 1000, // 30 minutes

  init() {
    App.on('project:selected', (project) => this.onProjectSelected(project));

    // Setup right-pane tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        App.state.rightTab = tabName;

        if (tabName === 'terminal2') {
          this.ensureRightTerminal();
        }

        setTimeout(() => this.fitAll(), 50);
      });
    });

    // Refit on window resize
    window.addEventListener('resize', () => this.fitAll());

    // Listen for terminal data from server
    App.on('terminal:data', (msg) => {
      const entry = this.terminals.get(msg.id);
      if (entry) {
        entry.term.write(msg.data);
        entry.lastActive = Date.now();
      }
    });

    App.on('terminal:exit', (msg) => {
      const entry = this.terminals.get(msg.id);
      if (entry) {
        entry.term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
        entry.exited = true;
      }
    });

    // Listen for agent status updates from server (via Claude Code hooks).
    // A null status means the server cleared the entry (e.g. another tab
    // clicked into the project) — propagate the clear to this tab too.
    App.on('agent:status', (msg) => {
      if (!msg.path) return;
      if (msg.status) {
        this.agentStatus.set(msg.path, msg.status);
      } else {
        this.agentStatus.delete(msg.path);
      }
      App.emit('agent:status:updated', { path: msg.path, status: msg.status || null });
    });

    // Load initial statuses from server
    this.loadInitialStatuses();

    // Reap idle sessions every 5 minutes
    setInterval(() => this.reapIdleSessions(), 5 * 60 * 1000);

    // On WS reconnect (e.g. server restart), re-create active terminal
    App.on('ws:reconnected', () => {
      // All server-side PTYs are gone — mark everything as exited and clear state
      for (const [id, entry] of this.terminals) {
        entry.exited = true;
        if (entry.wrapperEl.parentNode) {
          entry.wrapperEl.parentNode.removeChild(entry.wrapperEl);
        }
        entry.term.dispose();
      }
      this.terminals.clear();
      this.sessionsByPath.clear();

      // Re-create terminal for current project
      const project = App.state.selectedProject;
      if (project) {
        this.mainTermId = null;
        this.rightTermId = null;
        this.currentPath = null;
        this.onProjectSelected(project);
      }
    });

    // Show placeholder in middle pane
    this.showPlaceholder('terminal-container', 'Select a project to open terminal');
  },

  createTerminal(containerId, cwd, cmd, projectName, sticky) {
    const id = `term_${++this.counter}`;
    const container = document.getElementById(containerId);

    // Create a wrapper div for this terminal (so we can detach/reattach)
    const wrapperEl = document.createElement('div');
    wrapperEl.style.width = '100%';
    wrapperEl.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(wrapperEl);

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      theme: {
        background: '#121214',
        foreground: '#e8e6e3',
        cursor: '#e8a838',
        cursorAccent: '#121214',
        selectionBackground: 'rgba(232, 168, 56, 0.2)',
        selectionForeground: '#e8e6e3',
        black: '#1a1a1e',
        red: '#e85454',
        green: '#4aba6a',
        yellow: '#e8a838',
        blue: '#5a9bcf',
        magenta: '#b07acc',
        cyan: '#56b6c2',
        white: '#e8e6e3',
        brightBlack: '#555568',
        brightRed: '#ff6b6b',
        brightGreen: '#69db7c',
        brightYellow: '#f0b848',
        brightBlue: '#74b9ef',
        brightMagenta: '#c594dc',
        brightCyan: '#76d6e2',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(webLinksAddon);

    term.open(wrapperEl);

    term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

    // Send create FIRST, then fit (fit triggers onResize synchronously)
    let created = false;

    term.onResize(({ cols, rows }) => {
      if (created) {
        App.wsSend({ type: 'terminal:resize', id, cols, rows });
      }
    });

    term.onData((data) => {
      App.wsSend({ type: 'terminal:data', id, data });
    });

    setTimeout(() => {
      fitAddon.fit();
      App.wsSend({
        type: 'terminal:create',
        id,
        cwd,
        cmd: cmd || null,
        cols: term.cols,
        rows: term.rows,
        docker: App.state.dockerEnabled && !!projectName,
        projectName: projectName || null,
        sticky: !!sticky,
      });
      created = true;
      term.focus();
    }, 50);

    this.terminals.set(id, {
      term, fitAddon, wrapperEl, cwd, cmd,
      containerId,
      lastActive: Date.now(),
      exited: false,
    });

    return id;
  },

  // Detach terminal from DOM (keep alive in background)
  detachTerminal(id) {
    if (!id) return;
    const entry = this.terminals.get(id);
    if (entry && entry.wrapperEl.parentNode) {
      entry.wrapperEl.parentNode.removeChild(entry.wrapperEl);
    }
  },

  // Reattach terminal to a container
  attachTerminal(id, containerId) {
    const entry = this.terminals.get(id);
    if (!entry) return false;

    // If exited, don't reattach — caller should create new
    if (entry.exited) return false;

    const container = document.getElementById(containerId);
    container.innerHTML = '';
    container.appendChild(entry.wrapperEl);
    entry.containerId = containerId;
    entry.lastActive = Date.now();

    // Force a full refresh: fit, then trigger a redraw
    setTimeout(() => {
      try {
        entry.fitAddon.fit();
        entry.term.refresh(0, entry.term.rows - 1);
        entry.term.scrollToBottom();
        entry.term.focus();
      } catch {}
    }, 50);

    // Second focus after click event finishes bubbling
    setTimeout(() => {
      try { entry.term.focus(); } catch {}
    }, 150);

    return true;
  },

  // Fully destroy terminal (kill PTY, dispose xterm)
  destroyTerminal(id) {
    if (!id) return;
    const entry = this.terminals.get(id);
    if (entry) {
      App.wsSend({ type: 'terminal:close', id });
      if (entry.wrapperEl.parentNode) {
        entry.wrapperEl.parentNode.removeChild(entry.wrapperEl);
      }
      entry.term.dispose();
      this.terminals.delete(id);
    }
  },

  async onProjectSelected(project) {
    const prevPath = this.currentPath;

    if (!project) {
      // Save current before clearing
      if (prevPath && this.mainTermId) {
        this.sessionsByPath.set(prevPath, { mainId: this.mainTermId, rightId: this.rightTermId });
      }
      this.detachTerminal(this.mainTermId);
      this.detachTerminal(this.rightTermId);
      this.mainTermId = null;
      this.rightTermId = null;
      this.currentPath = null;
      this.showPlaceholder('terminal-container', 'Select a project to open terminal');
      document.getElementById('terminal-title').textContent = 'Agent';
      return;
    }

    // Same project, nothing to do
    if (prevPath === project.path) return;

    // Save current session mapping before switching
    if (prevPath && this.mainTermId) {
      this.sessionsByPath.set(prevPath, { mainId: this.mainTermId, rightId: this.rightTermId });
    }

    this.currentPath = project.path;

    // Detach current terminals (keep alive)
    this.detachTerminal(this.mainTermId);
    this.detachTerminal(this.rightTermId);

    // Check if we have an existing session for this project
    const existingSession = this.sessionsByPath.get(project.path);

    if (existingSession && existingSession.mainId) {
      // Try to reattach existing main terminal
      const reattached = this.attachTerminal(existingSession.mainId, 'terminal-container');
      if (reattached) {
        this.mainTermId = existingSession.mainId;
      } else {
        // Session exited, clean up and create new
        this.destroyTerminal(existingSession.mainId);
        this.mainTermId = await this.createNewMainTerminal(project);
      }
    } else {
      this.mainTermId = await this.createNewMainTerminal(project);
    }

    // Handle right terminal
    if (existingSession && existingSession.rightId) {
      const reattached = this.attachTerminal(existingSession.rightId, 'terminal2-container');
      if (reattached) {
        this.rightTermId = existingSession.rightId;
      } else {
        this.destroyTerminal(existingSession.rightId);
        this.rightTermId = null;
        if (App.state.rightTab === 'terminal2') {
          this.ensureRightTerminal();
        }
      }
    } else {
      this.rightTermId = null;
      if (App.state.rightTab === 'terminal2') {
        this.ensureRightTerminal();
      }
    }

    // Update session mapping
    this.sessionsByPath.set(project.path, {
      mainId: this.mainTermId,
      rightId: this.rightTermId,
    });

    document.getElementById('terminal-title').textContent = 'Agent';
  },

  async createNewMainTerminal(project) {
    const projName = project.parentProject || project.name;
    let cmd = null;

    // Resolve the lifecycle-appropriate command from the server
    if (project.type && project.type !== 'home') {
      try {
        const result = await App.api('POST', `/projects/${encodeURIComponent(projName)}/resolve-command`, {
          type: project.type,
          path: project.path,
        });
        if (result && result.command) cmd = result.command;
      } catch (err) {
        console.warn('Failed to resolve command, using default shell:', err);
      }
    }

    // If Docker is enabled, ensure container is running first
    if (App.state.dockerEnabled && project.type !== 'home') {
      try {
        await App.api('POST', `/docker/projects/${encodeURIComponent(projName)}/start`);
      } catch (err) {
        App.toast(`Docker: ${err.message}`, 'error');
        // Fall back to local terminal
        return this.createTerminal('terminal-container', project.path, cmd, null, true);
      }
    }

    const dockerProject = (App.state.dockerEnabled && project.type !== 'home') ? projName : null;
    const id = this.createTerminal('terminal-container', project.path, cmd, dockerProject, true);
    return id;
  },

  ensureRightTerminal() {
    if (this.rightTermId) {
      const entry = this.terminals.get(this.rightTermId);
      if (entry) setTimeout(() => entry.fitAddon.fit(), 50);
      return;
    }

    const sel = App.state.selectedProject;
    if (!sel) {
      this.showPlaceholder('terminal2-container', 'Select a project first');
      return;
    }

    const projName = sel.parentProject || sel.name;
    const dockerProject = (App.state.dockerEnabled && sel.type !== 'home') ? projName : null;
    this.rightTermId = this.createTerminal('terminal2-container', sel.path, null, dockerProject);

    // Update session mapping
    const session = this.sessionsByPath.get(sel.path) || {};
    session.rightId = this.rightTermId;
    this.sessionsByPath.set(sel.path, session);
  },

  // Reap sessions idle for more than SESSION_TTL
  reapIdleSessions() {
    const now = Date.now();
    for (const [id, entry] of this.terminals) {
      // Don't reap currently visible terminals
      if (id === this.mainTermId || id === this.rightTermId) continue;

      if (entry.exited || (now - entry.lastActive > this.SESSION_TTL)) {
        console.log(`[Terminal] Reaping idle session ${id} (cwd: ${entry.cwd})`);
        this.destroyTerminal(id);

        // Clean up session mapping
        for (const [path, session] of this.sessionsByPath) {
          if (session.mainId === id) session.mainId = null;
          if (session.rightId === id) session.rightId = null;
          if (!session.mainId && !session.rightId) {
            this.sessionsByPath.delete(path);
          }
        }
      }
    }
  },

  // ---- Agent Status (driven by server via Claude Code hooks) ----

  async loadInitialStatuses() {
    try {
      const data = await App.api('GET', '/agent-status');
      for (const [path, info] of Object.entries(data)) {
        this.agentStatus.set(path, info.status);
        App.emit('agent:status:updated', { path, status: info.status });
      }
    } catch { /* ignore on startup */ }
  },

  getAgentStatus(path) {
    return this.agentStatus.get(path) || null;
  },

  clearAgentStatus(path) {
    const status = this.agentStatus.get(path);
    // Only clear notification statuses (done, error), not persistent statuses (working, waiting)
    if (status === 'done' || status === 'error') {
      this.agentStatus.delete(path);
      App.emit('agent:status:updated', { path, status: null });
      // Tell the server to drop the sticky 'done' so subsequent hook events
      // can set a new status again.
      App.api('DELETE', `/agent-status?path=${encodeURIComponent(path)}`).catch(() => {});
    }
  },

  fitAll() {
    for (const [id, entry] of this.terminals) {
      // Only fit terminals that are attached to the DOM
      if (entry.wrapperEl.parentNode) {
        try { entry.fitAddon.fit(); } catch {}
      }
    }
  },

  showPlaceholder(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
      <div class="terminal-placeholder">
        <div class="placeholder-icon">▸</div>
        <span>${message}</span>
      </div>
    `;
  },
};
