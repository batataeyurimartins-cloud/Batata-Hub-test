const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = String(stored || '').split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

function createDefaultDb() {
  const now = new Date().toISOString();
  return {
    settings: {
      publicAccessUntil: null,
      siteTitle: 'Batata Protected'
    },
    users: [
      {
        id: crypto.randomUUID(),
        username: 'admin',
        passwordHash: hashPassword('admin123'),
        role: 'admin',
        bannedUntil: null,
        isActive: true,
        createdAt: now
      }
    ],
    auditLogs: [
      {
        id: crypto.randomUUID(),
        action: 'seed_admin',
        by: 'system',
        target: 'admin',
        details: 'Conta admin inicial criada automaticamente.',
        createdAt: now
      }
    ]
  };
}

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const db = createDefaultDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
      return db;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
      const db = createDefaultDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
      return db;
    }
    return parsed;
  } catch {
    const db = createDefaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    bannedUntil: user.bannedUntil,
    isActive: user.isActive,
    createdAt: user.createdAt
  };
}

function addLog(db, action, by, target, details = '') {
  db.auditLogs.unshift({
    id: crypto.randomUUID(),
    action,
    by,
    target,
    details,
    createdAt: new Date().toISOString()
  });
  db.auditLogs = db.auditLogs.slice(0, 200);
}

function isPublicOpen(db) {
  return Boolean(db.settings.publicAccessUntil && new Date(db.settings.publicAccessUntil).getTime() > Date.now());
}

function getSessionUser(req) {
  if (!req.session.userId) return null;
  const db = readDb();
  return db.users.find((user) => user.id === req.session.userId) || null;
}

function ensureLiveSession(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return next();

  if (!user.isActive) {
    req.session.destroy(() => {});
    return res.redirect('/login?error=' + encodeURIComponent('Conta desativada.'));
  }

  if (user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now()) {
    const until = new Date(user.bannedUntil).toLocaleString('pt-BR');
    req.session.destroy(() => {});
    return res.redirect('/login?error=' + encodeURIComponent(`Conta banida até ${until}.`));
  }

  req.currentUser = user;
  next();
}

function requireProtectedAccess(req, res, next) {
  const db = readDb();
  const user = getSessionUser(req);
  if (isPublicOpen(db)) {
    req.currentUser = user || null;
    req.accessMode = 'public';
    return next();
  }
  if (!user) return res.redirect('/login');
  if (!user.isActive) {
    req.session.destroy(() => {});
    return res.redirect('/login?error=' + encodeURIComponent('Conta desativada.'));
  }
  if (user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now()) {
    const until = new Date(user.bannedUntil).toLocaleString('pt-BR');
    req.session.destroy(() => {});
    return res.redirect('/login?error=' + encodeURIComponent(`Conta banida até ${until}.`));
  }
  req.currentUser = user;
  req.accessMode = 'private';
  next();
}

function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Faça login primeiro.' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin pode usar isso.' });
  if (!user.isActive) return res.status(403).json({ error: 'Conta admin desativada.' });
  if (user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now()) {
    return res.status(403).json({ error: 'Conta admin banida temporariamente.' });
  }
  req.adminUser = user;
  next();
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'troca-isso-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use('/assets', express.static(PUBLIC_DIR));

app.get('/login', ensureLiveSession, (req, res) => {
  if (req.currentUser) return res.redirect('/');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});
app.get('/', ensureLiveSession, requireProtectedAccess, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/games', ensureLiveSession, requireProtectedAccess, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'games.html')));
app.get('/jogo', ensureLiveSession, requireProtectedAccess, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'jogo.html')));
app.get('/admin', ensureLiveSession, requireProtectedAccess, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

app.get('/api/session', (req, res) => {
  const db = readDb();
  const user = getSessionUser(req);
  res.json({
    authenticated: Boolean(user),
    publicOpen: isPublicOpen(db),
    publicAccessUntil: db.settings.publicAccessUntil,
    user: user ? sanitizeUser(user) : null,
    canAccessSite: isPublicOpen(db) || Boolean(user)
  });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const db = readDb();
  const user = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  if (!user.isActive) {
    return res.status(403).json({ error: 'Conta desativada.' });
  }
  if (user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now()) {
    return res.status(403).json({ error: `Conta banida até ${new Date(user.bannedUntil).toLocaleString('pt-BR')}.` });
  }

  req.session.userId = user.id;
  addLog(db, 'login', user.username, user.username, 'Login realizado.');
  writeDb(db);
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/state', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({
    settings: db.settings,
    users: db.users.map(sanitizeUser),
    auditLogs: db.auditLogs.slice(0, 50)
  });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const db = readDb();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'user';

  if (username.length < 3) return res.status(400).json({ error: 'Usuário precisa ter pelo menos 3 caracteres.' });
  if (password.length < 4) return res.status(400).json({ error: 'Senha precisa ter pelo menos 4 caracteres.' });
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Esse usuário já existe.' });
  }

  const newUser = {
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
    role,
    bannedUntil: null,
    isActive: true,
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  addLog(db, 'create_user', req.adminUser.username, username, `Conta criada com cargo ${role}.`);
  writeDb(db);
  res.json({ ok: true, user: sanitizeUser(newUser) });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const action = String(req.body.action || '');
  const minutes = Number(req.body.minutes || 60);
  const password = String(req.body.password || '');

  if (user.username === 'admin' && (action === 'delete' || action === 'disable' || action === 'ban')) {
    return res.status(400).json({ error: 'A conta admin principal não pode receber essa ação.' });
  }

  if (action === 'ban') {
    const safeMinutes = Math.max(1, minutes);
    user.bannedUntil = new Date(Date.now() + safeMinutes * 60 * 1000).toISOString();
    addLog(db, 'ban_user', req.adminUser.username, user.username, `Banido por ${safeMinutes} minuto(s).`);
  } else if (action === 'unban') {
    user.bannedUntil = null;
    addLog(db, 'unban_user', req.adminUser.username, user.username, 'Ban removido.');
  } else if (action === 'disable') {
    user.isActive = false;
    addLog(db, 'disable_user', req.adminUser.username, user.username, 'Conta desativada.');
  } else if (action === 'enable') {
    user.isActive = true;
    addLog(db, 'enable_user', req.adminUser.username, user.username, 'Conta reativada.');
  } else if (action === 'reset_password') {
    if (password.length < 4) return res.status(400).json({ error: 'Nova senha precisa ter pelo menos 4 caracteres.' });
    user.passwordHash = hashPassword(password);
    addLog(db, 'reset_password', req.adminUser.username, user.username, 'Senha redefinida.');
  } else if (action === 'delete') {
    db.users = db.users.filter((item) => item.id !== user.id);
    addLog(db, 'delete_user', req.adminUser.username, user.username, 'Conta excluída.');
  } else {
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  writeDb(db);
  res.json({ ok: true });
});

app.patch('/api/admin/settings/public-access', requireAdmin, (req, res) => {
  const db = readDb();
  const action = String(req.body.action || '');
  const minutes = Number(req.body.minutes || 60);

  if (action === 'open') {
    const safeMinutes = Math.max(1, minutes);
    db.settings.publicAccessUntil = new Date(Date.now() + safeMinutes * 60 * 1000).toISOString();
    addLog(db, 'public_access_open', req.adminUser.username, 'site', `Site liberado por ${safeMinutes} minuto(s).`);
  } else if (action === 'close') {
    db.settings.publicAccessUntil = null;
    addLog(db, 'public_access_close', req.adminUser.username, 'site', 'Modo público encerrado.');
  } else {
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  writeDb(db);
  res.json({ ok: true, publicAccessUntil: db.settings.publicAccessUntil });
});

readDb();
app.listen(PORT, () => {
  console.log(`Batata Protected rodando em http://localhost:${PORT}`);
});
