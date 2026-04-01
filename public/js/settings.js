// ============================================================
// Settings — Modal for configuring project directory + Docker
// ============================================================

const Settings = {
  init() {
    const btnOpen = document.getElementById('btn-settings');
    const btnClose = document.getElementById('btn-close-settings');
    const btnSave = document.getElementById('btn-save-settings');
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('input-project-dir');

    btnOpen.addEventListener('click', () => this.open());
    btnClose.addEventListener('click', () => this.close());
    btnSave.addEventListener('click', () => this.save());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.save();
    });

    // Docker toggle
    document.getElementById('input-docker-enabled').addEventListener('change', (e) => {
      this.toggleDocker(e.target.checked);
    });

    // Build image button
    document.getElementById('btn-build-docker').addEventListener('click', () => this.buildDockerImage());
    document.getElementById('btn-stop-all-docker').addEventListener('click', () => this.stopAllContainers());
    document.getElementById('btn-reset-all-docker').addEventListener('click', () => this.removeAllContainers());

    // Load config
    this.load();
  },

  async load() {
    try {
      const cfg = await App.api('GET', '/config');
      App.state.projectDirectory = cfg.projectDirectory;
      App.state.dockerEnabled = cfg.dockerEnabled || false;
      document.getElementById('input-project-dir').value = cfg.projectDirectory;
      document.getElementById('input-docker-enabled').checked = cfg.dockerEnabled || false;
      this.refreshDockerStatus();
    } catch (err) {
      App.toast('Failed to load config: ' + err.message, 'error');
    }
  },

  open() {
    document.getElementById('input-project-dir').value = App.state.projectDirectory;
    document.getElementById('input-docker-enabled').checked = App.state.dockerEnabled;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('input-project-dir').focus();
    this.refreshDockerStatus();
  },

  close() {
    document.getElementById('modal-overlay').classList.add('hidden');
  },

  async save() {
    const dir = document.getElementById('input-project-dir').value.trim();
    if (!dir) return App.toast('Directory path required', 'error');

    const dockerEnabled = document.getElementById('input-docker-enabled').checked;

    try {
      const cfg = await App.api('PUT', '/config', { projectDirectory: dir, dockerEnabled });
      App.state.projectDirectory = cfg.projectDirectory;
      App.state.dockerEnabled = cfg.dockerEnabled;
      this.close();
      App.toast('Settings saved', 'success');
      Projects.refresh();
    } catch (err) {
      App.toast('Failed to save: ' + err.message, 'error');
    }
  },

  async toggleDocker(enabled) {
    try {
      const cfg = await App.api('PUT', '/config', { dockerEnabled: enabled });
      App.state.dockerEnabled = cfg.dockerEnabled;
      this.refreshDockerStatus();
    } catch (err) {
      App.toast('Failed to update Docker setting: ' + err.message, 'error');
    }
  },

  async refreshDockerStatus() {
    const statusLine = document.getElementById('docker-status-line');
    const buildBtn = document.getElementById('btn-build-docker');
    const stopAllBtn = document.getElementById('btn-stop-all-docker');
    const resetAllBtn = document.getElementById('btn-reset-all-docker');
    const containersList = document.getElementById('docker-containers-list');

    stopAllBtn.style.display = 'none';
    resetAllBtn.style.display = 'none';
    containersList.innerHTML = '';

    try {
      const status = await App.api('GET', '/docker/status');

      if (!status.available) {
        statusLine.textContent = 'Docker not found — install Docker Desktop to use this feature';
        statusLine.style.color = 'var(--danger)';
        buildBtn.style.display = 'none';
        return;
      }

      if (!status.imageExists) {
        statusLine.textContent = 'Docker available — image not built yet';
        statusLine.style.color = 'var(--accent)';
        buildBtn.style.display = '';
        buildBtn.textContent = 'Build Docker Image';
        buildBtn.disabled = false;
        return;
      }

      const containers = status.containers || [];
      const running = containers.filter(c => c.status.startsWith('Up')).length;
      statusLine.textContent = `Docker ready — ${running} container${running !== 1 ? 's' : ''} running`;
      statusLine.style.color = 'var(--success)';
      buildBtn.style.display = '';
      buildBtn.textContent = 'Rebuild Image';
      buildBtn.disabled = false;

      if (containers.length > 0) {
        stopAllBtn.style.display = '';
        resetAllBtn.style.display = '';

        containersList.innerHTML = containers.map(c => {
          const isUp = c.status.startsWith('Up');
          const name = c.name.replace(/^loom-/, '');
          const dotColor = isUp ? 'var(--success)' : 'var(--text-tertiary)';
          const projectName = c.name.replace(/^loom-/, '');
          return `<div style="display: flex; align-items: center; gap: 8px; padding: 4px 0;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${dotColor}; flex-shrink: 0;"></span>
            <span style="flex: 1; color: var(--text-secondary);">${name}</span>
            <span style="color: var(--text-tertiary); font-size: 10px;">${c.status}</span>
            <button class="btn btn-ghost" onclick="Settings.stopContainer('${projectName}')" style="font-size: 10px; padding: 2px 8px;">Stop</button>
            <button class="btn btn-ghost" onclick="Settings.removeContainer('${projectName}')" style="font-size: 10px; padding: 2px 8px; color: var(--danger);">Remove</button>
          </div>`;
        }).join('');
      }
    } catch (err) {
      statusLine.textContent = 'Failed to check Docker status';
      statusLine.style.color = 'var(--danger)';
    }
  },

  async buildDockerImage() {
    const buildBtn = document.getElementById('btn-build-docker');
    const statusLine = document.getElementById('docker-status-line');

    buildBtn.disabled = true;
    buildBtn.textContent = 'Building...';
    statusLine.textContent = 'Building Docker image (this may take a few minutes)...';
    statusLine.style.color = 'var(--accent)';

    try {
      await App.api('POST', '/docker/build');
      App.toast('Docker image built successfully', 'success');
      this.refreshDockerStatus();
    } catch (err) {
      App.toast('Build failed: ' + err.message, 'error');
      buildBtn.disabled = false;
      buildBtn.textContent = 'Retry Build';
      statusLine.textContent = 'Build failed — ' + err.message;
      statusLine.style.color = 'var(--danger)';
    }
  },

  async stopContainer(projectName) {
    try {
      await App.api('POST', `/docker/projects/${encodeURIComponent(projectName)}/stop`);
      App.toast(`Stopped ${projectName}`, 'success');
      this.refreshDockerStatus();
    } catch (err) {
      App.toast('Failed to stop: ' + err.message, 'error');
    }
  },

  async removeContainer(projectName) {
    try {
      await App.api('POST', `/docker/projects/${encodeURIComponent(projectName)}/stop`);
      App.toast(`Removed ${projectName}`, 'success');
      this.refreshDockerStatus();
    } catch (err) {
      App.toast('Failed to remove: ' + err.message, 'error');
    }
  },

  async stopAllContainers() {
    try {
      const status = await App.api('GET', '/docker/status');
      const running = (status.containers || []).filter(c => c.status.startsWith('Up'));
      await Promise.all(running.map(c =>
        App.api('POST', `/docker/projects/${encodeURIComponent(c.name.replace(/^loom-/, ''))}/stop`)
      ));
      App.toast(`Stopped ${running.length} container${running.length !== 1 ? 's' : ''}`, 'success');
      this.refreshDockerStatus();
    } catch (err) {
      App.toast('Failed to stop containers: ' + err.message, 'error');
    }
  },

  async removeAllContainers() {
    try {
      const status = await App.api('GET', '/docker/status');
      const containers = status.containers || [];
      await Promise.all(containers.map(c =>
        App.api('POST', `/docker/projects/${encodeURIComponent(c.name.replace(/^loom-/, ''))}/stop`)
      ));
      App.toast(`Removed ${containers.length} container${containers.length !== 1 ? 's' : ''}`, 'success');
      this.refreshDockerStatus();
    } catch (err) {
      App.toast('Failed to remove containers: ' + err.message, 'error');
    }
  },
};
