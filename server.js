const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

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

function defaultDb() {
  return {
    settings: {
      publicAccessUntil: null,
      siteTitle: 'Batata Secure Hub'
    },
    users: [
      {
        id: crypto.randomUUID(),
        username: 'admin',
        passwordHash: hashPassword('admin123'),
        role: 'admin',
        bannedUntil: null,
        isActive: true,
        createdAt: new Date().toISOString()
      }
    ],
    auditLogs: [
      {
        id: crypto.randomUUID(),
        action: 'seed_admin',
        by: 'system',
        target: 'admin',
        createdAt: new Date().toISOString(),
        details: 'Conta admin inicial criada.'
      }
    ]
  };
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
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

function isPublicOpen(db) {
  return db.settings.publicAccessUntil && new Date(db.settings.publicAccessUntil).getTime() > Date.now();
}

function getSessionUser(req) {
  const db = readDb();
  const id = req.session.userId;
  if (!id) return null;
  return db.users.find((u) => u.id === id) || null;
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'batata-super-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use('/assets', express.static(path.join(__dirname, 'public')));

function requireAccess(req, res, next) {
  const db = readDb();
  const user = getSessionUser(req);

  if (isPublicOpen(db)) {
    req.accessMode = 'public';
    req.currentUser = user ? sanitizeUser(user) : null;
    return next();
  }

  if (!user) return res.redirect('/login');
  if (!user.isActive) {
    req.session.destroy(() => {});
    return res.redirect('/login?error=Conta desativada');
  }
  if (user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now()) {
    req.session.destroy(() => {});
    return res.redirect(`/login?error=${encodeURIComponent('Você está banido até ' + new Date(user.bannedUntil).toLocaleString('pt-BR'))}`);
  }

  req.currentUser = sanitizeUser(user);
  next();
}

function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
  if (!user.isActive) return res.status(403).json({ error: 'Conta admin desativada.' });
  if (user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now()) return res.status(403).json({ error: 'Conta admin banida temporariamente.' });
  req.adminUser = user;
  next();
}

app.get('/', requireAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/games', requireAccess, (req, res) => res.sendFile(path.join(__dirname, 'public', 'games.html')));
app.get('/jogo', requireAccess, (req, res) => res.sendFile(path.join(__dirname, 'public', 'jogo.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', requireAccess, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/session', (req, res) => {
  const db = readDb();
  const user = getSessionUser(req);
  const publicOpen = isPublicOpen(db);
  res.json({
    authenticated: !!user,
    publicOpen,
    publicAccessUntil: db.settings.publicAccessUntil,
    user: user ? sanitizeUser(user) : null,
    canAccessSite: publicOpen || !!user
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDb();
  const user = db.users.find((u) => u.username.toLowerCase() === String(username || '').trim().toLowerCase());

  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  if (!user.isActive) {
    return res.status(403).json({ error: 'Conta desativada.' });
  }
  if (user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now()) {
    return res.status(403).json({ error: `Conta banida até ${new Date(user.bannedUntil).toLocaleString('pt-BR')}.` });
  }

  req.session.userId = user.id;
  addLog(db, 'login', user.username, user.username, 'Login realizado com sucesso.');
  writeDb(db);
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/admin/state', requireAdmin, (req, res) => {
  const db = readDb();
  res.json({
    settings: db.settings,
    users: db.users.map(sanitizeUser),
    auditLogs: db.auditLogs.slice(0, 30)
  });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  const cleanUsername = String(username || '').trim();
  const cleanPassword = String(password || '');
  const cleanRole = role === 'admin' ? 'admin' : 'user';

  if (cleanUsername.length < 3) return res.status(400).json({ error: 'Username precisa ter pelo menos 3 caracteres.' });
  if (cleanPassword.length < 4) return res.status(400).json({ error: 'Senha precisa ter pelo menos 4 caracteres.' });

  const db = readDb();
  const exists = db.users.some((u) => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Esse usuário já existe.' });

  const newUser = {
    id: crypto.randomUUID(),
    username: cleanUsername,
    passwordHash: hashPassword(cleanPassword),
    role: cleanRole,
    bannedUntil: null,
    isActive: true,
    createdAt: new Date().toISOString()
  };
  db.users.push(newUser);
  addLog(db, 'create_user', req.adminUser.username, cleanUsername, `Conta criada com role ${cleanRole}.`);
  writeDb(db);
  res.json({ ok: true, user: sanitizeUser(newUser) });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const { action, minutes, password } = req.body;
  if (user.username === 'admin' && action === 'delete') {
    return res.status(400).json({ error: 'A conta admin principal não pode ser excluída.' });
  }

  if (action === 'ban') {
    const mins = Math.max(1, Number(minutes || 60));
    user.bannedUntil = new Date(Date.now() + mins * 60 * 1000).toISOString();
    addLog(db, 'ban_user', req.adminUser.username, user.username, `Banido por ${mins} minuto(s).`);
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
    const cleanPassword = String(password || '');
    if (cleanPassword.length < 4) return res.status(400).json({ error: 'Nova senha precisa ter pelo menos 4 caracteres.' });
    user.passwordHash = hashPassword(cleanPassword);
    addLog(db, 'reset_password', req.adminUser.username, user.username, 'Senha redefinida.');
  } else if (action === 'delete') {
    db.users = db.users.filter((u) => u.id !== user.id);
    addLog(db, 'delete_user', req.adminUser.username, user.username, 'Conta excluída.');
  } else {
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  writeDb(db);
  res.json({ ok: true });
});

app.patch('/api/admin/settings/public-access', requireAdmin, (req, res) => {
  const db = readDb();
  const { action, minutes } = req.body;

  if (action === 'open') {
    const mins = Math.max(1, Number(minutes || 60));
    db.settings.publicAccessUntil = new Date(Date.now() + mins * 60 * 1000).toISOString();
    addLog(db, 'public_access_open', req.adminUser.username, 'site', `Site liberado por ${mins} minuto(s).`);
  } else if (action === 'close') {
    db.settings.publicAccessUntil = null;
    addLog(db, 'public_access_close', req.adminUser.username, 'site', 'Modo público encerrado.');
  } else {
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  writeDb(db);
  res.json({ ok: true, publicAccessUntil: db.settings.publicAccessUntil });
});

app.listen(PORT, () => {
  console.log(`Batata Secure Hub rodando em http://localhost:${PORT}`);
});
