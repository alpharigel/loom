const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const os = require('os');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

app.use(express.json());

// CORS — allow cross-origin requests for multi-instance support
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Loom-Profile');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Extract active profile from X-Loom-Profile header (sent by frontend)
app.use((req, res, next) => {
  req.profileName = req.headers['x-loom-profile'] || null;
  next();
});

// In HA ingress mode, inject <base> tag so relative paths resolve correctly
app.get('/', (req, res, next) => {
  const ingressPath = req.headers['x-ingress-path'];
  if (!ingressPath) return next();
  const safePath = ingressPath.replace(/[^a-zA-Z0-9/_-]/g, '');
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
  html = html.replace('<head>', `<head><base href="${safePath}/">`);
  res.type('html').send(html);
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/xterm', express.static(path.join(__dirname, 'node_modules/xterm')));
app.use('/vendor/xterm-addon-fit', express.static(path.join(__dirname, 'node_modules/xterm-addon-fit')));
app.use('/vendor/xterm-addon-web-links', express.static(path.join(__dirname, 'node_modules/xterm-addon-web-links')));

// ---------------------------------------------------------------------------
// Platform detection & shell discovery
// ---------------------------------------------------------------------------

const IS_WINDOWS = process.platform === 'win32';

// Detect tmux once at startup; sticky terminal sessions depend on it.
const HAS_TMUX = (() => {
  try {
    execSync(IS_WINDOWS ? 'where tmux' : 'command -v tmux', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

// Candidate shells probed at startup. Order matters: first-found becomes the
// default when the user hasn't explicitly picked one in settings.
const SHELL_CANDIDATES = IS_WINDOWS
  ? [
      { label: 'PowerShell 7 (pwsh)', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
      { label: 'Windows PowerShell', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
      { label: 'Git Bash', path: 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' },
      { label: 'Git Bash (bin)', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
      { label: 'Command Prompt', path: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe' },
      { label: 'WSL', path: 'C:\\Windows\\System32\\wsl.exe' },
    ]
  : [
      { label: 'zsh', path: '/bin/zsh' },
      { label: 'bash', path: '/bin/bash' },
      { label: 'fish', path: '/usr/bin/fish' },
      { label: 'sh', path: '/bin/sh' },
    ];

function discoverShells() {
  const found = [];
  for (const c of SHELL_CANDIDATES) {
    if (fs.existsSync(c.path)) found.push(c);
  }
  // Also honor $SHELL if it points at something real and not already listed.
  if (process.env.SHELL && fs.existsSync(process.env.SHELL) && !found.some(s => s.path === process.env.SHELL)) {
    found.push({ label: `$SHELL (${path.basename(process.env.SHELL)})`, path: process.env.SHELL });
  }
  return found;
}

function platformDefaultShell() {
  const shells = discoverShells();
  if (shells.length) return shells[0].path;
  return IS_WINDOWS ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const APP_CONFIG_DIR = process.env.LOOM_DATA_DIR || path.join(os.homedir(), '.loom');
const APP_CONFIG_FILE = path.join(APP_CONFIG_DIR, 'config.json');
const PROJECT_CONFIG_FILE = path.join(APP_CONFIG_DIR, 'project-config.json');
const SCRATCH_DIR = path.join(APP_CONFIG_DIR, 'scratch');
const AGENTS_DIR = path.join(APP_CONFIG_DIR, 'agents');
const SKILLS_DIR = path.join(APP_CONFIG_DIR, 'skills');
const WORKTREES_DIR = path.join(APP_CONFIG_DIR, 'worktrees');
const CLAUDE_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const PROFILES_FILE = path.join(APP_CONFIG_DIR, 'profiles.json');
const PROFILES_DIR = path.join(APP_CONFIG_DIR, 'profiles');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filepath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filepath, data) {
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Normalize command config: old string format -> object, null -> empty object
function normalizeCommandConfig(cmd) {
  if (!cmd) return { projectInit: null, projectResume: null, worktreeInit: null, worktreeResume: null };
  if (typeof cmd === 'string') return { projectInit: cmd, projectResume: cmd, worktreeInit: cmd, worktreeResume: cmd };
  return {
    projectInit: cmd.projectInit || null,
    projectResume: cmd.projectResume || null,
    worktreeInit: cmd.worktreeInit || null,
    worktreeResume: cmd.worktreeResume || null,
  };
}

function getAppConfig() {
  ensureDir(APP_CONFIG_DIR);
  const defaults = {
    projectDirectory: process.env.LOOM_PROJECT_DIR || path.join(os.homedir(), 'Dev'),
    dockerEnabled: false,
    defaultShell: platformDefaultShell(),
  };
  const cfg = readJSON(APP_CONFIG_FILE, defaults);
  if (!cfg.projectDirectory) cfg.projectDirectory = defaults.projectDirectory;
  if (cfg.dockerEnabled === undefined) cfg.dockerEnabled = false;
  if (!cfg.defaultShell) cfg.defaultShell = defaults.defaultShell;
  return cfg;
}

function saveAppConfig(cfg) {
  writeJSON(APP_CONFIG_FILE, cfg);
}

function getProjectConfig() {
  const defaults = { projectOrder: [], commands: {} };
  // Primary: ~/.loom/project-config.json
  if (fs.existsSync(PROJECT_CONFIG_FILE)) {
    return readJSON(PROJECT_CONFIG_FILE, defaults);
  }
  // Fallback: old location {projectDir}/.loom/config.json (pre-migration compat)
  const appCfg = getAppConfig();
  const oldCfgFile = path.join(appCfg.projectDirectory, '.loom', 'config.json');
  return readJSON(oldCfgFile, defaults);
}

function saveProjectConfig(cfg) {
  writeJSON(PROJECT_CONFIG_FILE, cfg);
}

// ---------------------------------------------------------------------------
// Profile helpers
// ---------------------------------------------------------------------------

function getProfiles() {
  return readJSON(PROFILES_FILE, []);
}

function saveProfiles(profiles) {
  writeJSON(PROFILES_FILE, profiles);
}

function getProfile(name) {
  return getProfiles().find(p => p.name === name);
}

function ensureProfile(name) {
  const profiles = getProfiles();
  let profile = profiles.find(p => p.name === name);
  if (!profile) {
    profile = { name, avatar: null };
    profiles.push(profile);
    saveProfiles(profiles);
  }
  ensureProfileDirs(name);
  return profile;
}

function getProfileScratchDir(name) {
  return path.join(PROFILES_DIR, name, 'scratch');
}

function getProfileAgentsDir(name) {
  return path.join(PROFILES_DIR, name, 'agents');
}

function ensureProfileDirs(name) {
  ensureDir(getProfileScratchDir(name));
  ensureDir(getProfileAgentsDir(name));
}

// Loom-managed tmux config — portable across Mac/Linux/Windows
const LOOM_TMUX_CONF = path.join(APP_CONFIG_DIR, 'tmux.conf');

const LOOM_TMUX_OPTIONS = [
  'set -g mouse on',
  'set -g set-clipboard on',
  'set -g history-limit 50000',
  'set -g default-terminal "xterm-256color"',
];

function ensureTmuxConfig() {
  const conf = LOOM_TMUX_OPTIONS.join('\n') + '\n';

  ensureDir(APP_CONFIG_DIR);
  // Only write if missing or different
  if (!fs.existsSync(LOOM_TMUX_CONF) || fs.readFileSync(LOOM_TMUX_CONF, 'utf-8') !== conf) {
    fs.writeFileSync(LOOM_TMUX_CONF, conf);
  }
}

// Apply tmux options to the running server (the -f flag only works when starting
// a new tmux server, so we need to source the config for already-running servers).
function applyTmuxOptions() {
  try {
    execSync(`tmux source-file ${LOOM_TMUX_CONF}`, { stdio: 'pipe' });
  } catch { /* no tmux server running yet — options will apply via -f on first session */ }
}

// ---------------------------------------------------------------------------
// Section helpers
// ---------------------------------------------------------------------------

function getWorktreeDir(section, itemName) {
  return path.join(WORKTREES_DIR, section || 'projects', itemName);
}

function getItemDir(section, itemName, profileName) {
  const appCfg = getAppConfig();
  const dirs = {
    scratch: profileName ? getProfileScratchDir(profileName) : SCRATCH_DIR,
    agents: profileName ? getProfileAgentsDir(profileName) : AGENTS_DIR,
    projects: appCfg.projectDirectory,
    skills: SKILLS_DIR,
  };
  return path.join(dirs[section] || dirs.projects, itemName);
}

function scanSection(baseDir, sectionType, projCfg) {
  if (!fs.existsSync(baseDir)) return [];
  const allDirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => ({
      name: d.name,
      ctime: fs.statSync(path.join(baseDir, d.name)).birthtimeMs,
    }))
    .sort((a, b) => b.ctime - a.ctime) // newest first
    .map(d => d.name);

  const items = [];
  for (const name of allDirs) {
    const fullPath = path.join(baseDir, name);
    if (!isGitRepo(fullPath)) continue;

    const worktreeDir = getWorktreeDir(sectionType, name);
    let worktrees = [];
    if (fs.existsSync(worktreeDir)) {
      worktrees = fs.readdirSync(worktreeDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => ({ branch: d.name, path: path.join(worktreeDir, d.name) }));
    }

    const hasIcon = fs.existsSync(path.join(fullPath, '.loom', 'icon.svg'));

    items.push({
      name,
      path: fullPath,
      worktrees,
      command: normalizeCommandConfig(projCfg.commands && projCfg.commands[name]),
      section: sectionType,
      hasIcon,
    });
  }
  return items;
}

function discoverSkills() {
  if (!fs.existsSync(CLAUDE_SKILLS_DIR)) return [];
  const skills = [];
  try {
    const dirs = fs.readdirSync(CLAUDE_SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const d of dirs) {
      const skillMd = path.join(CLAUDE_SKILLS_DIR, d.name, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        skills.push({
          name: d.name,
          path: path.join(CLAUDE_SKILLS_DIR, d.name),
          section: 'skills',
          worktrees: [],
        });
      }
    }
  } catch { /* ignore */ }
  return skills;
}

// ---------------------------------------------------------------------------
// Tmux helpers (sticky sessions)
// ---------------------------------------------------------------------------

function tmuxSessionName(cwd) {
  // Deterministic session name from path: loom_<basename>_<short-hash>
  const base = path.basename(cwd).replace(/[^a-zA-Z0-9_-]/g, '_');
  const hash = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 8);
  return `loom_${base}_${hash}`;
}

function tmuxSessionExists(sessionName) {
  try {
    execSync(`tmux has-session -t ${sessionName}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Docker management
// ---------------------------------------------------------------------------

const LOOM_IMAGE = 'loom-agent';
const CONTAINER_PREFIX = 'loom-';
const PORT_BASE = 4001;

const Docker = {
  // Check if Docker is available
  available() {
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  },

  // Build the base loom-agent image
  async buildImage() {
    const dockerDir = path.join(__dirname, 'docker');
    if (!fs.existsSync(path.join(dockerDir, 'Dockerfile'))) {
      throw new Error('Dockerfile not found in docker/');
    }

    const uid = process.getuid ? process.getuid() : 501;
    const gid = process.getgid ? process.getgid() : 501;

    return new Promise((resolve, reject) => {
      const cmd = `docker build --build-arg USER_UID=${uid} --build-arg USER_GID=${gid} -t ${LOOM_IMAGE} "${dockerDir}"`;
      log(`docker:build ${cmd}`);
      exec(cmd, { timeout: 300000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        log('docker:build complete');
        resolve(stdout);
      });
    });
  },

  // Check if image exists
  imageExists() {
    try {
      execSync(`docker image inspect ${LOOM_IMAGE}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  },

  // Get container name for a project
  containerName(projectName) {
    return `${CONTAINER_PREFIX}${sanitize(projectName)}`;
  },

  // Get assigned host port for a project
  getHostPort(projectName) {
    const cfg = getProjectConfig();
    if (!cfg.dockerPorts) cfg.dockerPorts = {};
    if (cfg.dockerPorts[projectName]) return cfg.dockerPorts[projectName];

    // Auto-assign next available port
    const usedPorts = Object.values(cfg.dockerPorts);
    let port = PORT_BASE;
    while (usedPorts.includes(port)) port++;
    cfg.dockerPorts[projectName] = port;
    saveProjectConfig(cfg);
    return port;
  },

  // Get container status
  containerStatus(projectName) {
    const name = this.containerName(projectName);
    try {
      const out = execSync(`docker inspect --format '{{.State.Status}}' ${name}`, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return out; // running, exited, paused, etc.
    } catch {
      return null; // container doesn't exist
    }
  },

  // Create and start container for a project
  async startContainer(projectName, projectPath) {
    const name = this.containerName(projectName);
    const hostPort = this.getHostPort(projectName);
    const status = this.containerStatus(projectName);

    if (status === 'running') {
      log(`docker:already-running ${name}`);
      return { name, hostPort, status: 'running' };
    }

    if (status === 'exited' || status === 'created') {
      // Restart existing container
      log(`docker:restart ${name}`);
      execSync(`docker start ${name}`, { stdio: 'pipe' });
      return { name, hostPort, status: 'running' };
    }

    // Check for per-project Dockerfile
    const projectDockerfile = path.join(projectPath, '.loom', 'Dockerfile');
    let image = LOOM_IMAGE;
    if (fs.existsSync(projectDockerfile)) {
      const projectImage = `${LOOM_IMAGE}-${sanitize(projectName)}`;
      log(`docker:build-project-image ${projectImage}`);
      try {
        execSync(`docker build -t ${projectImage} "${path.join(projectPath, '.loom')}"`, {
          stdio: 'pipe', timeout: 300000
        });
        image = projectImage;
      } catch (e) {
        log(`docker:build-project-image-failed ${e.message}, falling back to base`);
      }
    }

    // Resolve host paths for volume mounts
    const ghConfigPath = path.join(os.homedir(), '.config', 'gh');
    const sshPath = path.join(os.homedir(), '.ssh');
    const gitconfigPath = path.join(os.homedir(), '.gitconfig');

    // Build volume mounts
    let volumes = `-v "${projectPath}:/workspace"`;
    // Mount worktrees directory so worktree terminals land in the right place
    const dockerWtDir = getWorktreeDir('projects', projectName);
    if (fs.existsSync(dockerWtDir)) {
      volumes += ` -v "${dockerWtDir}:/worktrees"`;
    }
    if (fs.existsSync(ghConfigPath)) volumes += ` -v "${ghConfigPath}:/home/loom/.config/gh:ro"`;
    if (fs.existsSync(sshPath)) volumes += ` -v "${sshPath}:/home/loom/.ssh:ro"`;
    if (fs.existsSync(gitconfigPath)) volumes += ` -v "${gitconfigPath}:/home/loom/.gitconfig:ro"`;

    // Pass through API keys from host environment
    let envFlags = '';
    const passthroughEnvs = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN'];
    for (const key of passthroughEnvs) {
      if (process.env[key]) envFlags += ` -e ${key}`;
    }

    const cmd = `docker run -d --name ${name} -p ${hostPort}:3000 ${volumes} ${envFlags} -w /workspace ${image} sleep infinity`;
    log(`docker:create ${cmd}`);

    try {
      execSync(cmd, { stdio: 'pipe', env: process.env });
      return { name, hostPort, status: 'running' };
    } catch (e) {
      throw new Error(`Failed to start container: ${e.message}`);
    }
  },

  // Stop and remove container
  stopContainer(projectName) {
    const name = this.containerName(projectName);
    try {
      execSync(`docker rm -f ${name}`, { stdio: 'pipe' });
      log(`docker:stopped ${name}`);
    } catch { /* ignore if doesn't exist */ }
  },

  // Exec into container, returning a PTY-like interface
  execInContainer(projectName, cols, rows, cmd, cwd) {
    const name = this.containerName(projectName);
    const workdir = cwd ? `-w "${cwd}"` : '';
    const shellCmd = cmd || '/bin/zsh';

    // Use docker exec with PTY allocation
    const args = ['exec', '-it', workdir, name, shellCmd].filter(Boolean);
    // We need to use node-pty to spawn docker exec for proper TTY
    const ptyProcess = pty.spawn('docker', ['exec', '-it', ...(cwd ? ['-w', cwd] : []), name, shellCmd], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    return ptyProcess;
  },

  // List all loom containers with status
  listContainers() {
    try {
      const out = execSync(
        `docker ps -a --filter "name=${CONTAINER_PREFIX}" --format '{"name":"{{.Names}}","status":"{{.Status}}","ports":"{{.Ports}}"}'`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (!out) return [];
      return out.split('\n').map(line => JSON.parse(line));
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Sanitize names
// ---------------------------------------------------------------------------

function sanitize(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function isGitRepo(dir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getWorktrees(projectDir) {
  try {
    const out = execSync('git worktree list --porcelain', { cwd: projectDir, encoding: 'utf-8' });
    const worktrees = [];
    let current = {};
    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice(9) };
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === '') {
        if (current.path && current.path !== projectDir) {
          worktrees.push(current);
        }
        current = {};
      }
    }
    return worktrees;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// API: Config
// ---------------------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json(getAppConfig());
});

app.get('/api/shells', (req, res) => {
  const cfg = getAppConfig();
  res.json({
    shells: discoverShells(),
    current: cfg.defaultShell,
    hasTmux: HAS_TMUX,
    platform: process.platform,
  });
});

app.put('/api/config', (req, res) => {
  const cfg = getAppConfig();
  if (req.body.projectDirectory) {
    cfg.projectDirectory = req.body.projectDirectory;
    ensureDir(cfg.projectDirectory);
  }
  if (req.body.dockerEnabled !== undefined) {
    cfg.dockerEnabled = req.body.dockerEnabled;
  }
  if (req.body.host !== undefined) {
    cfg.host = req.body.host || 'localhost';
  }
  if (typeof req.body.defaultShell === 'string' && req.body.defaultShell.trim()) {
    cfg.defaultShell = req.body.defaultShell.trim();
  }
  saveAppConfig(cfg);
  setupWatcher();
  res.json(cfg);
});

// Restart server (used after config changes that require restart, e.g. host binding)
app.post('/api/restart', (req, res) => {
  res.json({ ok: true });
  // Touch server.js to trigger node --watch restart
  setTimeout(() => {
    const serverFile = path.join(__dirname, 'server.js');
    const now = new Date();
    fs.utimesSync(serverFile, now, now);
  }, 200);
});

// ---------------------------------------------------------------------------
// API: Projects
// ---------------------------------------------------------------------------

app.get('/api/projects', (req, res) => {
  const appCfg = getAppConfig();
  const projDir = appCfg.projectDirectory;
  ensureDir(projDir);

  const projCfg = getProjectConfig();
  const archiveDir = path.join(projDir, '.archive');
  ensureDir(archiveDir);

  // Ensure section directories exist
  const profileName = req.profileName;
  const scratchDir = profileName ? getProfileScratchDir(profileName) : SCRATCH_DIR;
  const agentsDir = profileName ? getProfileAgentsDir(profileName) : AGENTS_DIR;
  [scratchDir, agentsDir, SKILLS_DIR, WORKTREES_DIR].forEach(ensureDir);

  // Scan each section (scratch/agents are per-profile when a profile is active)
  const scratch = scanSection(scratchDir, 'scratch', projCfg);
  const agents = scanSection(agentsDir, 'agents', projCfg);
  const projects = scanSection(projDir, 'projects', projCfg);
  const skills = discoverSkills();

  // Sort projects by configured order, then newest-first (from scanSection)
  const order = projCfg.projectOrder || [];
  projects.sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });

  // Archived projects
  const archived = [];
  if (fs.existsSync(archiveDir)) {
    const archiveDirs = fs.readdirSync(archiveDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const d of archiveDirs) {
      archived.push({ name: d.name, path: path.join(archiveDir, d.name) });
    }
  }

  res.json({
    home: { name: '~', path: os.homedir() },
    scratch,
    agents,
    projects,
    skills,
    archived,
  });
});

// Lazy-load worktrees for a single project (includes git worktree list).
// The main working tree (itemDir itself) is filtered out — the project row
// in the explorer already represents it, so surfacing it again as a
// "task" worktree is just noise.
app.get('/api/projects/:name/worktrees', (req, res) => {
  const section = req.query.section || 'projects';
  const itemDir = getItemDir(section, req.params.name, req.profileName);
  if (!fs.existsSync(itemDir)) return res.status(404).json({ error: 'Item not found' });

  const worktreeDir = getWorktreeDir(section, req.params.name);
  const mainPath = path.resolve(itemDir);
  const samePath = (a, b) => {
    const na = path.resolve(a);
    const nb = path.resolve(b);
    return IS_WINDOWS ? na.toLowerCase() === nb.toLowerCase() : na === nb;
  };

  let worktrees = [];

  if (fs.existsSync(worktreeDir)) {
    worktrees = fs.readdirSync(worktreeDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ branch: d.name, path: path.join(worktreeDir, d.name) }));
  }

  // Also check git's own worktree list, but skip the main working tree.
  const gitWorktrees = getWorktrees(itemDir);
  for (const gwt of gitWorktrees) {
    if (samePath(gwt.path, mainPath)) continue;
    if (!worktrees.find(w => samePath(w.path, gwt.path))) {
      worktrees.push({ branch: gwt.branch || path.basename(gwt.path), path: gwt.path });
    }
  }

  res.json({ worktrees });
});

app.post('/api/projects', (req, res) => {
  const { name, section } = req.body;
  const profileName = req.profileName;

  // Route to appropriate directory based on section (scratch/agents are per-user)
  const sectionDirs = {
    scratch: profileName ? getProfileScratchDir(profileName) : SCRATCH_DIR,
    agents: profileName ? getProfileAgentsDir(profileName) : AGENTS_DIR,
    skills: SKILLS_DIR,
    projects: getAppConfig().projectDirectory,
  };
  const baseDir = sectionDirs[section] || sectionDirs.projects;

  createSectionItem(baseDir, name, res);
});

// ---------------------------------------------------------------------------
// API: GitHub clone (list orgs/repos, clone)
// ---------------------------------------------------------------------------

app.get('/api/github/orgs', async (req, res) => {
  try {
    // Get authenticated user
    const userJson = await ghExec('api user --jq "{login, type: .type}"');
    const user = JSON.parse(userJson);

    // Get orgs the user belongs to
    const orgsJson = await ghExec('api user/orgs --jq "[.[].login]"');
    const orgs = JSON.parse(orgsJson);

    res.json({ user: user.login, orgs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/github/repos', async (req, res) => {
  const { owner } = req.query;
  if (!owner) return res.status(400).json({ error: 'owner query param required' });

  try {
    // Determine if owner is the authenticated user or an org
    const userJson = await ghExec('api user --jq ".login"');
    const currentUser = userJson.replace(/"/g, '').trim();

    let reposJson;
    if (owner === currentUser) {
      reposJson = await ghExec(
        `api "user/repos?per_page=100&sort=updated&affiliation=owner" --jq "[.[] | {name, full_name, description, private: .private, updated_at}]"`,
        undefined
      );
    } else {
      reposJson = await ghExec(
        `api "orgs/${owner}/repos?per_page=100&sort=updated" --jq "[.[] | {name, full_name, description, private: .private, updated_at}]"`,
        undefined
      );
    }
    const repos = JSON.parse(reposJson);

    // Filter out repos that already exist in the projects directory
    const appCfg = getAppConfig();
    const projDir = appCfg.projectDirectory;
    const existingDirs = new Set();
    if (fs.existsSync(projDir)) {
      for (const d of fs.readdirSync(projDir)) {
        existingDirs.add(d.toLowerCase());
      }
    }

    const filtered = repos.map(r => ({
      ...r,
      alreadyCloned: existingDirs.has(r.name.toLowerCase()),
    }));

    res.json({ repos: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/github/clone', async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl required' });

  const appCfg = getAppConfig();
  const projDir = appCfg.projectDirectory;

  // Extract repo name from URL or owner/repo format
  let repoName;
  if (repoUrl.includes('/')) {
    const parts = repoUrl.replace(/\.git$/, '').split('/');
    repoName = parts[parts.length - 1];
  } else {
    repoName = repoUrl;
  }

  const targetPath = path.join(projDir, repoName);
  if (fs.existsSync(targetPath)) {
    return res.status(409).json({ error: `Project "${repoName}" already exists` });
  }

  try {
    // Use gh repo clone which handles auth automatically
    execSync(`gh repo clone "${repoUrl}" "${targetPath}"`, {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 120000,
    });
    res.json({ name: repoName, path: targetPath });
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

app.post('/api/projects/:name/archive', (req, res) => {
  const appCfg = getAppConfig();
  const projDir = appCfg.projectDirectory;
  const src = path.join(projDir, req.params.name);
  const archiveDir = path.join(projDir, '.archive');
  const dest = path.join(archiveDir, req.params.name);

  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Project not found' });

  ensureDir(archiveDir);

  // Remove any worktrees first
  const worktreeDir = getWorktreeDir('projects', req.params.name);
  if (fs.existsSync(worktreeDir)) {
    const branches = fs.readdirSync(worktreeDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const b of branches) {
      try {
        execSync(`git worktree remove "${path.join(worktreeDir, b.name)}" --force`, { cwd: src, stdio: 'pipe' });
      } catch { /* ignore */ }
    }
    try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  fs.renameSync(src, dest);
  res.json({ success: true });
});

app.post('/api/projects/:name/unarchive', (req, res) => {
  const appCfg = getAppConfig();
  const projDir = appCfg.projectDirectory;
  const src = path.join(projDir, '.archive', req.params.name);
  const dest = path.join(projDir, req.params.name);

  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Archived project not found' });
  if (fs.existsSync(dest)) return res.status(409).json({ error: 'Project with that name already exists' });

  fs.renameSync(src, dest);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// API: Scratch & Agents
// ---------------------------------------------------------------------------

function createSectionItem(baseDir, name, res) {
  if (!name) return res.status(400).json({ error: 'Name required' });
  const sanitized = sanitize(name);
  if (!sanitized) return res.status(400).json({ error: 'Invalid name' });

  const fullPath = path.join(baseDir, sanitized);
  if (fs.existsSync(fullPath)) {
    return res.status(409).json({ error: 'Already exists' });
  }

  ensureDir(fullPath);
  execSync('git init', { cwd: fullPath, stdio: 'pipe' });
  fs.writeFileSync(path.join(fullPath, 'README.md'), `# ${name}\n`);
  execSync('git add -A && git commit -m "Initial commit"', { cwd: fullPath, stdio: 'pipe' });

  res.json({ name: sanitized, path: fullPath });
}

app.post('/api/scratch', (req, res) => {
  const profileName = req.profileName;
  createSectionItem(profileName ? getProfileScratchDir(profileName) : SCRATCH_DIR, req.body.name, res);
});

app.post('/api/agents', (req, res) => {
  const profileName = req.profileName;
  createSectionItem(profileName ? getProfileAgentsDir(profileName) : AGENTS_DIR, req.body.name, res);
});

app.delete('/api/sections/:section/:name', (req, res) => {
  const { section, name } = req.params;
  const profileName = req.profileName;
  const sectionDirs = {
    scratch: profileName ? getProfileScratchDir(profileName) : SCRATCH_DIR,
    agents: profileName ? getProfileAgentsDir(profileName) : AGENTS_DIR,
  };
  const baseDir = sectionDirs[section];
  if (!baseDir) return res.status(400).json({ error: `Cannot delete from ${section}` });

  const sanitized = sanitize(name);
  if (!sanitized) return res.status(400).json({ error: 'Invalid name' });

  const fullPath = path.join(baseDir, sanitized);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Not found' });

  fs.rmSync(fullPath, { recursive: true, force: true });
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// API: Worktrees
// ---------------------------------------------------------------------------

app.post('/api/projects/:name/worktrees', (req, res) => {
  const { branch, section } = req.body;
  if (!branch) return res.status(400).json({ error: 'Branch name required' });

  const sanitized = sanitize(branch);
  if (!sanitized) return res.status(400).json({ error: 'Invalid branch name' });

  const sectionType = section || 'projects';
  const itemDir = getItemDir(sectionType, req.params.name, req.profileName);
  if (!fs.existsSync(itemDir)) return res.status(404).json({ error: 'Item not found' });

  const worktreeDir = getWorktreeDir(sectionType, req.params.name);
  ensureDir(worktreeDir);
  const wtPath = path.join(worktreeDir, sanitized);

  if (fs.existsSync(wtPath)) {
    return res.status(409).json({ error: 'Worktree already exists' });
  }

  try {
    execSync(`git worktree add -b "${sanitized}" "${wtPath}"`, { cwd: itemDir, stdio: 'pipe' });
    res.json({ branch: sanitized, path: wtPath });
  } catch (err) {
    // Branch might already exist, try without -b
    try {
      execSync(`git worktree add "${wtPath}" "${sanitized}"`, { cwd: itemDir, stdio: 'pipe' });
      res.json({ branch: sanitized, path: wtPath });
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

app.delete('/api/projects/:name/worktrees/:branch', (req, res) => {
  const sectionType = req.query.section || 'projects';
  const itemDir = getItemDir(sectionType, req.params.name, req.profileName);
  const wtPath = path.join(getWorktreeDir(sectionType, req.params.name), req.params.branch);

  if (!fs.existsSync(wtPath)) return res.status(404).json({ error: 'Worktree not found' });

  try {
    execSync(`git worktree remove "${wtPath}" --force`, { cwd: itemDir, stdio: 'pipe' });
  } catch {
    // Fallback: manually remove
    try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* ignore */ }
    try { execSync('git worktree prune', { cwd: itemDir, stdio: 'pipe' }); } catch { /* ignore */ }
  }

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// API: Project order & command
// ---------------------------------------------------------------------------

app.put('/api/projects/order', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array' });

  const cfg = getProjectConfig();
  cfg.projectOrder = order;
  saveProjectConfig(cfg);
  res.json({ success: true });
});

app.put('/api/projects/:name/command', (req, res) => {
  const { commands } = req.body;
  const cfg = getProjectConfig();
  if (!cfg.commands) cfg.commands = {};
  // commands is an object: { projectInit, projectResume, worktreeInit, worktreeResume }
  if (commands && typeof commands === 'object') {
    cfg.commands[req.params.name] = {
      projectInit: commands.projectInit || null,
      projectResume: commands.projectResume || null,
      worktreeInit: commands.worktreeInit || null,
      worktreeResume: commands.worktreeResume || null,
    };
  } else {
    cfg.commands[req.params.name] = null;
  }
  saveProjectConfig(cfg);
  res.json({ success: true });
});

// Serve project icon SVG
app.get('/api/projects/:name/icon', (req, res) => {
  const section = req.query.section || 'projects';
  const itemDir = getItemDir(section, req.params.name, req.profileName);
  const iconPath = path.join(itemDir, '.loom', 'icon.svg');
  if (fs.existsSync(iconPath)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(iconPath).pipe(res);
  } else {
    res.status(404).json({ error: 'No icon' });
  }
});


// Resolve which command to use based on lifecycle stage, and mark as initialized
app.post('/api/projects/:name/resolve-command', (req, res) => {
  const { type, path: targetPath } = req.body; // type: 'project' | 'worktree'
  const cfg = getProjectConfig();
  if (!cfg.initialized) cfg.initialized = {};

  const rawCmd = cfg.commands && cfg.commands[req.params.name];
  // Backward compat: old string format -> treat as projectInit
  const cmdCfg = typeof rawCmd === 'string'
    ? { projectInit: rawCmd, projectResume: rawCmd, worktreeInit: rawCmd, worktreeResume: rawCmd }
    : (rawCmd || {});

  const isInitialized = cfg.initialized[targetPath] === true;
  let command = null;

  if (type === 'worktree') {
    command = isInitialized ? (cmdCfg.worktreeResume || null) : (cmdCfg.worktreeInit || null);
  } else {
    command = isInitialized ? (cmdCfg.projectResume || null) : (cmdCfg.projectInit || null);
  }

  // Mark as initialized
  if (!isInitialized) {
    cfg.initialized[targetPath] = true;
    saveProjectConfig(cfg);
  }

  res.json({ command });
});

// ---------------------------------------------------------------------------
// API: Docker
// ---------------------------------------------------------------------------

app.get('/api/docker/status', (req, res) => {
  res.json({
    available: Docker.available(),
    imageExists: Docker.imageExists(),
    containers: Docker.listContainers(),
  });
});

app.post('/api/docker/build', async (req, res) => {
  try {
    await Docker.buildImage();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/docker/projects/:name/start', async (req, res) => {
  const appCfg = getAppConfig();
  const projDir = path.join(appCfg.projectDirectory, req.params.name);
  if (!fs.existsSync(projDir)) return res.status(404).json({ error: 'Project not found' });

  try {
    const result = await Docker.startContainer(req.params.name, projDir);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/docker/projects/:name/stop', (req, res) => {
  Docker.stopContainer(req.params.name);
  res.json({ success: true });
});

app.get('/api/docker/projects/:name/status', (req, res) => {
  const status = Docker.containerStatus(req.params.name);
  const hostPort = Docker.getHostPort(req.params.name);
  res.json({ status, hostPort, containerName: Docker.containerName(req.params.name) });
});

// ---------------------------------------------------------------------------
// API: Dashboard — enriched overview of all projects
// ---------------------------------------------------------------------------

app.get('/api/dashboard', async (req, res) => {
  const appCfg = getAppConfig();
  const projDir = appCfg.projectDirectory;
  ensureDir(projDir);

  const projCfg = getProjectConfig();

  const allDirs = fs.readdirSync(projDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);

  // Build project list with local git data (fast, synchronous)
  const projects = [];
  for (const name of allDirs) {
    const fullPath = path.join(projDir, name);
    if (!isGitRepo(fullPath)) continue;

    const project = {
      name,
      path: fullPath,
      command: (projCfg.commands && projCfg.commands[name]) || null,
      branch: null,
      lastCommit: null,
      issueCount: 0,
      prCount: 0,
      worktreeCount: 0,
      hasGithub: false,
    };

    // Current branch
    try {
      project.branch = execSync('git branch --show-current', {
        cwd: fullPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
      }).trim() || 'HEAD';
    } catch { project.branch = 'unknown'; }

    // Latest commit
    try {
      const logOut = execSync(
        'git log -1 --format=\'{"message":"%s","author":"%an","date":"%aI"}\'',
        { cwd: fullPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (logOut) project.lastCommit = JSON.parse(logOut);
    } catch {}

    // Worktree count (filesystem only — fast)
    const wtDir = getWorktreeDir('projects', name);
    if (fs.existsSync(wtDir)) {
      project.worktreeCount = fs.readdirSync(wtDir, { withFileTypes: true })
        .filter(d => d.isDirectory()).length;
    }

    // Check for GitHub remote
    try {
      const remotes = execSync('git remote -v', { cwd: fullPath, encoding: 'utf-8' });
      if (remotes.includes('github.com')) {
        project.hasGithub = true;
      }
    } catch {}

    projects.push(project);
  }

  // Fetch GitHub issue/PR counts in parallel across all projects
  await Promise.all(projects.filter(p => p.hasGithub).map(async (project) => {
    try {
      const [issuesJson, prsJson] = await Promise.all([
        ghExec('issue list --state open --json number --limit 100', project.path).catch(() => '[]'),
        ghExec('pr list --state open --json number --limit 100', project.path).catch(() => '[]'),
      ]);
      project.issueCount = JSON.parse(issuesJson).length;
      project.prCount = JSON.parse(prsJson).length;
    } catch {}
  }));

  // Sort by most recent commit date (newest first)
  projects.sort((a, b) => {
    const dateA = a.lastCommit?.date ? new Date(a.lastCommit.date).getTime() : 0;
    const dateB = b.lastCommit?.date ? new Date(b.lastCommit.date).getTime() : 0;
    return dateB - dateA;
  });

  res.json({ projects });
});

// ---------------------------------------------------------------------------
// API: GitHub details (via gh CLI)
// ---------------------------------------------------------------------------

function ghExec(args, cwd) {
  return new Promise((resolve, reject) => {
    exec(`gh ${args}`, { cwd, encoding: 'utf-8', timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

app.get('/api/projects/:name/github', async (req, res) => {
  const appCfg = getAppConfig();
  const projDir = path.join(appCfg.projectDirectory, req.params.name);
  if (!fs.existsSync(projDir)) return res.status(404).json({ error: 'Project not found' });

  // Check if project has a GitHub remote
  let hasRemote = false;
  try {
    const remotes = execSync('git remote -v', { cwd: projDir, encoding: 'utf-8' });
    hasRemote = remotes.includes('github.com');
  } catch {}

  if (!hasRemote) {
    return res.json({ hasGithub: false });
  }

  const result = { hasGithub: true };

  // Repo overview
  try {
    const repoJson = await ghExec('repo view --json name,description,stargazerCount,forkCount,primaryLanguage,defaultBranchRef,visibility,repositoryTopics,pushedAt,url,isPrivate', projDir);
    result.repo = JSON.parse(repoJson);
  } catch (e) {
    result.repoError = e.message;
  }

  // Open issues
  try {
    const issuesJson = await ghExec('issue list --state open --json number,title,author,labels,createdAt,url --limit 30', projDir);
    result.issues = JSON.parse(issuesJson);
  } catch (e) {
    result.issuesError = e.message;
  }

  // Open PRs
  try {
    const prsJson = await ghExec('pr list --state open --json number,title,author,labels,createdAt,url,headRefName --limit 20', projDir);
    result.prs = JSON.parse(prsJson);
  } catch (e) {
    result.prsError = e.message;
  }

  // Recent commits
  try {
    const commitsJson = await ghExec('api repos/{owner}/{repo}/commits?per_page=10 --jq "[.[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}]"', projDir);
    result.commits = JSON.parse(commitsJson);
  } catch (e) {
    result.commitsError = e.message;
  }

  // README
  try {
    const readmePath = path.join(projDir, 'README.md');
    if (fs.existsSync(readmePath)) {
      result.readme = fs.readFileSync(readmePath, 'utf-8');
    }
  } catch {}

  // Worktrees
  const ghWorktreeDir = getWorktreeDir('projects', req.params.name);
  result.worktrees = [];
  if (fs.existsSync(ghWorktreeDir)) {
    const branches = fs.readdirSync(ghWorktreeDir, { withFileTypes: true }).filter(d => d.isDirectory());
    result.worktrees = branches.map(d => ({
      branch: d.name,
      path: path.join(ghWorktreeDir, d.name),
    }));
  }
  // Also include git worktree list
  const gitWorktrees = getWorktrees(projDir);
  for (const gwt of gitWorktrees) {
    if (!result.worktrees.find(w => w.path === gwt.path)) {
      result.worktrees.push({ branch: gwt.branch || path.basename(gwt.path), path: gwt.path });
    }
  }

  res.json(result);
});

// ---------------------------------------------------------------------------
// API: Files
// ---------------------------------------------------------------------------

app.get('/api/files', (req, res) => {
  const dirPath = req.query.path;
  if (!dirPath) return res.status(400).json({ error: 'path required' });

  // Security: resolve and check the path
  const resolved = path.resolve(dirPath);

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const files = entries
      .map(e => ({
        name: e.name,
        path: path.join(resolved, e.name),
        isDirectory: e.isDirectory(),
        isHidden: e.name.startsWith('.'),
        size: e.isFile() ? (fs.statSync(path.join(resolved, e.name)).size) : null,
      }))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        if (a.isHidden && !b.isHidden) return 1;
        if (!a.isHidden && b.isHidden) return -1;
        return a.name.localeCompare(b.name);
      });

    res.json({ path: resolved, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  const resolved = path.resolve(filePath);
  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    const ext = path.extname(resolved).slice(1);
    res.json({ path: resolved, name: path.basename(resolved), content, ext });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/file', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  const resolved = path.resolve(filePath);
  try {
    fs.writeFileSync(resolved, content);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files/mkdir', (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: 'path required' });

  const resolved = path.resolve(dirPath);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Agent Status — receives Claude Code hook events, broadcasts via WebSocket
// ---------------------------------------------------------------------------

const agentStatuses = new Map(); // projectPath -> { status, timestamp }

function mapHookToStatus(hookEventName, notificationType) {
  switch (hookEventName) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'UserPromptSubmit':
      return 'working';
    case 'Notification':
      // All Notification variants indicate the agent is paused awaiting the
      // user — map to 'waiting'. 'done' is reserved for Stop.
      if (notificationType === 'idle_prompt') return 'waiting';
      if (notificationType === 'permission_prompt') return 'waiting';
      if (notificationType === 'elicitation_dialog') return 'waiting';
      return null;
    case 'Stop':
      return 'done';
    case 'StopFailure':
      return 'error';
    default:
      return null;
  }
}

function resolveProjectPath(cwd) {
  const appCfg = getAppConfig();
  const projDir = appCfg.projectDirectory;

  // Worktrees live at WORKTREES_DIR/<section>/<project>/<branch>/...
  if (cwd === WORKTREES_DIR || cwd.startsWith(WORKTREES_DIR + path.sep)) {
    const rel = cwd.slice(WORKTREES_DIR.length + 1);
    const parts = rel.split(path.sep);
    if (parts.length >= 3) {
      return path.join(WORKTREES_DIR, parts[0], parts[1], parts[2]);
    }
    return cwd;
  }

  // Managed projects live at projDir/<project>/...
  if (projDir && (cwd === projDir || cwd.startsWith(projDir + path.sep))) {
    const rel = cwd.slice(projDir.length + 1);
    const topDir = rel.split(path.sep)[0];
    if (topDir) return path.join(projDir, topDir);
  }

  return cwd;
}

app.post('/api/agent-status', (req, res) => {
  const { hook_event_name, cwd, notification_type } = req.body;
  if (!hook_event_name || !cwd) return res.status(400).json({ error: 'missing fields' });

  log(`agent-status: event=${hook_event_name} cwd=${cwd} notification=${notification_type || ''}`);

  const status = mapHookToStatus(hook_event_name, notification_type);
  if (!status) return res.json({ ok: true, ignored: true });

  const projectPath = resolveProjectPath(cwd);

  // Terminal states (done, error) stick until the client explicitly clears them
  // by clicking into the project. This guards against:
  //   (a) async hook delivery: PostToolUse and Stop fire back-to-back when the
  //       agent finishes; with async:true they can land out of order, causing
  //       the green dot to flash off as a late 'working' overwrites 'done'.
  //   (b) the product rule: green means "agent finished, you haven't looked
  //       yet" — it should persist until acknowledged.
  // 'error' is allowed to supersede 'done' so a late failure isn't hidden.
  const prev = agentStatuses.get(projectPath);
  if (prev) {
    if (prev.status === 'done' && status !== 'error') {
      return res.json({ ok: true, preserved: prev.status });
    }
    if (prev.status === 'error') {
      return res.json({ ok: true, preserved: prev.status });
    }
  }

  agentStatuses.set(projectPath, { status, timestamp: Date.now() });

  // Broadcast to all WS clients
  const msg = JSON.stringify({ type: 'agent:status', path: projectPath, status });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });

  res.json({ ok: true, status });
});

app.get('/api/agent-status', (req, res) => {
  const result = {};
  for (const [path, info] of agentStatuses) {
    result[path] = info;
  }
  res.json(result);
});

app.delete('/api/agent-status', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).json({ error: 'missing path' });
  const prev = agentStatuses.get(p);
  if (prev && (prev.status === 'done' || prev.status === 'error')) {
    agentStatuses.delete(p);
    const msg = JSON.stringify({ type: 'agent:status', path: p, status: null });
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(msg);
    });
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Machine identity & peer discovery (mDNS)
// ---------------------------------------------------------------------------

const { Bonjour } = require('bonjour-service');
let bonjourInstance = null;

function createBonjour() {
  return new Bonjour(undefined, (err) => {
    console.warn('  mDNS error (non-fatal):', err.message);
  });
}

app.get('/api/identity', (req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
  res.json({
    hostname: os.hostname(),
    port: boundPort,
    os: process.platform,
    user: os.userInfo().username,
    version: pkg.version,
  });
});

app.get('/api/peers', (req, res) => {
  try {
    const bonjour = createBonjour();
    const peers = [];
    const browser = bonjour.find({ type: 'loom' }, (service) => {
      peers.push({
        name: service.name,
        host: service.host,
        addresses: service.addresses || [],
        port: service.port,
        txt: service.txt || {},
      });
    });
    // Browse for 2 seconds then return results
    setTimeout(() => {
      try { browser.stop(); bonjour.destroy(); } catch { /* ignore */ }
      res.json({ peers });
    }, 2000);
  } catch (err) {
    console.warn('  mDNS peer discovery failed:', err.message);
    res.json({ peers: [] });
  }
});

// ---------------------------------------------------------------------------
// Profiles API
// ---------------------------------------------------------------------------

// List all profiles
app.get('/api/profiles', (req, res) => {
  res.json(getProfiles());
});

// Create or update a profile
app.post('/api/profiles', (req, res) => {
  const { name, avatar } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitized) return res.status(400).json({ error: 'Invalid profile name' });

  const profiles = getProfiles();
  const existing = profiles.find(p => p.name === sanitized);
  if (existing) {
    if (avatar !== undefined) existing.avatar = avatar;
  } else {
    profiles.push({ name: sanitized, avatar: avatar || null });
  }
  saveProfiles(profiles);
  ensureProfileDirs(sanitized);
  res.json(profiles.find(p => p.name === sanitized));
});

// Rename a profile
app.post('/api/profiles/:name/rename', (req, res) => {
  const oldName = req.params.name;
  const { newName } = req.body;
  if (!newName) return res.status(400).json({ error: 'newName required' });
  const sanitized = newName.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitized) return res.status(400).json({ error: 'Invalid profile name' });

  const profiles = getProfiles();
  const existing = profiles.find(p => p.name === oldName);
  if (!existing) return res.status(404).json({ error: 'Profile not found' });
  if (profiles.find(p => p.name === sanitized && p.name !== oldName)) {
    return res.status(409).json({ error: 'Profile name already taken' });
  }

  // Rename the profile directory if it exists
  const oldDir = path.join(PROFILES_DIR, oldName);
  const newDir = path.join(PROFILES_DIR, sanitized);
  if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
    fs.renameSync(oldDir, newDir);
  }

  existing.name = sanitized;
  saveProfiles(profiles);
  ensureProfileDirs(sanitized);
  res.json(existing);
});

// Delete a profile
app.delete('/api/profiles/:name', (req, res) => {
  const profiles = getProfiles().filter(p => p.name !== req.params.name);
  saveProfiles(profiles);
  res.json({ ok: true });
});

// Ensure a profile exists (used when switching machines — auto-creates if missing)
app.post('/api/profiles/ensure', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const profile = ensureProfile(name);
  res.json(profile);
});

// ---------------------------------------------------------------------------
// WebSocket: Terminal multiplexing + file watching
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

function log(msg, ...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`, ...args);
}

// Global terminal map — PTYs survive WebSocket reconnects
const globalTerminals = new Map(); // id -> { pty, ws }

wss.on('connection', (ws) => {
  log('WS client connected');

  // Kill all existing PTYs — client is starting fresh and will create what it needs
  for (const [id, term] of globalTerminals) {
    log(`terminal:cleanup-on-connect id=${id}`);
    try { term.pty.kill(); } catch { /* ignore */ }
  }
  globalTerminals.clear();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'terminal:create': {
        const id = msg.id;
        const cwd = msg.cwd || os.homedir();
        const appCfgForShell = getAppConfig();
        const shell = msg.cmd || appCfgForShell.defaultShell || process.env.SHELL || platformDefaultShell();
        const useDocker = msg.docker || false;
        const projectName = msg.projectName || null;
        // Sticky sessions require tmux; silently fall through when unavailable
        // (e.g. native Windows) so terminals still work, just without persistence.
        const useSticky = (msg.sticky || false) && HAS_TMUX;

        log(`terminal:create id=${id} cwd=${cwd} shell=${shell} docker=${useDocker} sticky=${useSticky}`);

        try {
          let ptyProcess;

          if (useDocker && projectName) {
            // Docker mode: exec into the project's container
            const containerName = Docker.containerName(projectName);
            const status = Docker.containerStatus(projectName);

            if (status !== 'running') {
              throw new Error(`Container ${containerName} is not running (status: ${status}). Start it first.`);
            }

            // Translate host cwd to container path
            const appCfg = getAppConfig();
            const worktreeHostDir = getWorktreeDir('projects', projectName);
            const projectHostDir = path.join(appCfg.projectDirectory, projectName);
            let containerCwd = '/workspace';
            if (cwd.startsWith(worktreeHostDir)) {
              // cwd is inside a worktree — map to /worktrees/<branch>
              containerCwd = '/worktrees' + cwd.slice(worktreeHostDir.length);
            } else if (cwd.startsWith(projectHostDir)) {
              // cwd is inside the main project — map to /workspace/<subpath>
              const sub = cwd.slice(projectHostDir.length);
              containerCwd = '/workspace' + sub;
            }

            log(`terminal:docker-exec id=${id} container=${containerName} cwd=${containerCwd}`);
            ptyProcess = pty.spawn('docker', [
              'exec', '-it', '-w', containerCwd, containerName, shell
            ], {
              name: 'xterm-256color',
              cols: msg.cols || 80,
              rows: msg.rows || 24,
              cwd: os.homedir(),
              env: { ...process.env, TERM: 'xterm-256color' },
            });
          } else if (useSticky) {
            // Sticky mode: spawn inside a tmux session that persists across server restarts
            const sessionName = tmuxSessionName(cwd);
            const alreadyExists = tmuxSessionExists(sessionName);
            const effectiveCwd = fs.existsSync(cwd) ? cwd : os.homedir();

            // Kill any existing PTY attached to the same tmux session to avoid duplicate I/O
            for (const [oldId, oldTerm] of globalTerminals) {
              if (oldTerm.stickySession === sessionName) {
                log(`terminal:sticky-replace id=${oldId} (replacing old PTY for session ${sessionName})`);
                try { oldTerm.pty.kill(); } catch { /* ignore */ }
                globalTerminals.delete(oldId);
              }
            }

            log(`terminal:sticky id=${id} session=${sessionName} exists=${alreadyExists}`);

            // tmux new-session -A: attach if exists, create if not
            ptyProcess = pty.spawn('tmux', [
              '-f', LOOM_TMUX_CONF,
              'new-session', '-A', '-s', sessionName, '-c', effectiveCwd,
            ], {
              name: 'xterm-256color',
              cols: msg.cols || 80,
              rows: msg.rows || 24,
              cwd: effectiveCwd,
              env: { ...process.env, TERM: 'xterm-256color', HOME: os.homedir() },
            });

            // If this is a brand-new session and the caller supplied an
            // explicit command (not a raw shell fallback), type it into tmux.
            if (!alreadyExists && msg.cmd) {
              setTimeout(() => {
                try { ptyProcess.write(msg.cmd + '\n'); } catch { /* ignore */ }
              }, 300);
            }
          } else {
            // Local mode: spawn shell directly.
            // If `shell` is an existing absolute path (possibly with spaces,
            // e.g. "C:\\Program Files\\Git\\usr\\bin\\bash.exe"), use it as-is.
            // Otherwise try to resolve via PATH lookup (which on unix, where on win).
            let shellCmd = shell;
            let shellArgs = [];
            if (!path.isAbsolute(shellCmd) || !fs.existsSync(shellCmd)) {
              // Bare name or not found: attempt PATH resolution
              try {
                const lookup = IS_WINDOWS ? `where ${shellCmd}` : `command -v ${shellCmd}`;
                const resolved = execSync(lookup, { encoding: 'utf-8' }).trim().split(/\r?\n/)[0];
                if (resolved) shellCmd = resolved;
              } catch {
                shellCmd = platformDefaultShell();
              }
            }

            ptyProcess = pty.spawn(shellCmd, shellArgs, {
              name: 'xterm-256color',
              cols: msg.cols || 80,
              rows: msg.rows || 24,
              cwd: fs.existsSync(cwd) ? cwd : os.homedir(),
              env: { ...process.env, TERM: 'xterm-256color', HOME: os.homedir() },
            });
          }

          log(`terminal:spawned id=${id} pid=${ptyProcess.pid}`);

          ptyProcess.onData((data) => {
            const term = globalTerminals.get(id);
            const activeWs = term ? term.ws : ws;
            if (activeWs && activeWs.readyState === 1) {
              activeWs.send(JSON.stringify({ type: 'terminal:data', id, data }));
            }
          });

          ptyProcess.onExit(({ exitCode }) => {
            log(`terminal:exit id=${id} exitCode=${exitCode}`);
            const term = globalTerminals.get(id);
            const activeWs = term ? term.ws : ws;
            globalTerminals.delete(id);
            if (activeWs && activeWs.readyState === 1) {
              activeWs.send(JSON.stringify({ type: 'terminal:exit', id, exitCode }));
            }
          });

          const stickySession = useSticky ? tmuxSessionName(cwd) : null;
          globalTerminals.set(id, { pty: ptyProcess, ws, sticky: useSticky, stickySession });
        } catch (err) {
          log(`terminal:error id=${id} error=${err.message}`);
          ws.send(JSON.stringify({ type: 'terminal:error', id, error: err.message }));
        }
        break;
      }

      case 'terminal:data': {
        const term = globalTerminals.get(msg.id);
        if (term) {
          try { term.pty.write(msg.data); } catch (e) {
            log(`terminal:write-error id=${msg.id} error=${e.message}`);
          }
        }
        break;
      }

      case 'terminal:resize': {
        const term = globalTerminals.get(msg.id);
        if (term) {
          try { term.pty.resize(msg.cols, msg.rows); } catch { /* ignore */ }
        }
        break;
      }

      case 'terminal:close': {
        const term = globalTerminals.get(msg.id);
        if (term) {
          log(`terminal:close id=${msg.id}`);
          try { term.pty.kill(); } catch { /* ignore */ }
          globalTerminals.delete(msg.id);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    log(`WS client disconnected (${globalTerminals.size} terminals preserved)`);
  });
});

// ---------------------------------------------------------------------------
// Chokidar: Watch project directory for changes
// ---------------------------------------------------------------------------

let watcher = null;
let watchDebounce = null;

function setupWatcher() {
  if (watcher) watcher.close();

  const appCfg = getAppConfig();
  const projDir = appCfg.projectDirectory;

  const dirsToWatch = [projDir, PROFILES_DIR, SKILLS_DIR, WORKTREES_DIR]
    .filter(d => fs.existsSync(d));
  if (dirsToWatch.length === 0) return;

  watcher = chokidar.watch(dirsToWatch, {
    depth: 2,
    ignoreInitial: true,
    ignored: [
      /(^|[\/\\])\..(?!archive)/, // ignore dotfiles except .archive
      /node_modules/,
    ],
  });

  const notify = (type, filePath) => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'fs:changed', detail: type, path: filePath }));
        }
      });
    }, 300);
  };

  watcher.on('addDir', p => notify('addDir', p));
  watcher.on('unlinkDir', p => notify('unlinkDir', p));
  watcher.on('add', p => notify('add', p));
  watcher.on('unlink', p => notify('unlink', p));
  watcher.on('change', p => notify('change', p));
}

// ---------------------------------------------------------------------------
// Dev live-reload: watch own frontend files and notify clients to reload
// ---------------------------------------------------------------------------

let devWatcher = null;

function setupDevWatcher() {
  if (process.env.NODE_ENV === 'production') return;
  if (devWatcher) devWatcher.close();

  const watchPaths = [
    path.join(__dirname, 'public'),
  ];

  devWatcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    ignored: /node_modules/,
  });

  let devDebounce = null;
  devWatcher.on('all', (event, filePath) => {
    clearTimeout(devDebounce);
    devDebounce = setTimeout(() => {
      log(`dev:reload triggered by ${path.basename(filePath)}`);
      wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'dev:reload' }));
        }
      });
    }, 200);
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const START_PORT = parseInt(process.env.PORT || 3000);
const HOST = process.env.HOST || getAppConfig().host || 'localhost';
const MAX_PORT_ATTEMPTS = 10;
let boundPort = START_PORT;

function listenWithFallback(port, attemptsLeft) {
  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 1) {
      console.warn(`  Port ${port} is in use, trying ${port + 1}...`);
      server.removeListener('error', onError);
      listenWithFallback(port + 1, attemptsLeft - 1);
    } else {
      console.error(`\n  Failed to bind to ${HOST}:${port} — ${err.message}\n`);
      process.exit(1);
    }
  };
  server.once('error', onError);
  server.listen(port, HOST, () => {
    server.removeListener('error', onError);
    boundPort = port;
    console.log(`\n  Loom running at http://${HOST}:${boundPort}`);
    if (HOST === 'localhost' || HOST === '127.0.0.1') {
      console.log(`  To expose on LAN, set host to 0.0.0.0 in Settings or run: HOST=0.0.0.0 npm run dev\n`);
    } else {
      console.log('');
    }
    ensureDir(getAppConfig().projectDirectory);
    ensureTmuxConfig();
    applyTmuxOptions();
    setupWatcher();
    setupDevWatcher();

    // Advertise via mDNS for peer discovery (skip in HA add-on mode)
    if (!process.env.LOOM_HA_MODE) {
      try {
        bonjourInstance = createBonjour();
        bonjourInstance.publish({
          name: `Loom-${os.hostname()}-${boundPort}`,
          type: 'loom',
          port: boundPort,
          txt: {
            hostname: os.hostname(),
            os: process.platform,
            user: os.userInfo().username,
          },
        });
        console.log(`  mDNS: advertising as Loom-${os.hostname()}-${boundPort} (_loom._tcp)\n`);
      } catch (err) {
        console.warn('  mDNS: failed to advertise:', err.message);
      }
    }
  });
}

listenWithFallback(START_PORT, MAX_PORT_ATTEMPTS);

// Graceful shutdown — unpublish mDNS (don't call process.exit, let node --watch handle restarts)
function cleanupMdns() {
  if (bonjourInstance) {
    try { bonjourInstance.unpublishAll(); bonjourInstance.destroy(); } catch { /* ignore */ }
    bonjourInstance = null;
  }
}
process.on('SIGTERM', () => { cleanupMdns(); process.exit(0); });
process.on('exit', cleanupMdns);
