// ============================================================
// Notes API server — Express + PostgreSQL (Supabase)
// Single-file frontend: index.html (인라인 React) + 이 server.js
// ============================================================

const path = require('path');

// Load .env from next to this file, regardless of the current working
// directory (so `node server.js` works even when launched from elsewhere).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// PostgreSQL pool (Supabase transaction pooler requires SSL)
// .trim() guards against trailing-newline quirks in env vars.
// ------------------------------------------------------------
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').trim(),
  ssl: { rejectUnauthorized: false },
});

// ------------------------------------------------------------
// Lazy migration: create the table once. The flag prevents the
// CREATE TABLE from re-running on every request / serverless cold start.
// ------------------------------------------------------------
let dbInitialized = false;
async function initDB() {
  if (dbInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      body  TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  dbInitialized = true;
}

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Ensure the table exists before any /api request is handled.
app.use('/api', async (_req, res, next) => {
  try {
    await initDB();
    next();
  } catch (err) {
    console.error('DB init failed:', err.message);
    res.status(500).json({ success: false, message: '데이터베이스 초기화에 실패했습니다.' });
  }
});

// ------------------------------------------------------------
// API routes
// ------------------------------------------------------------

// List all notes, newest first.
app.get('/api/notes', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, body, created_at FROM notes ORDER BY created_at DESC, id DESC'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/notes:', err.message);
    res.status(500).json({ success: false, message: '메모를 불러오지 못했습니다.' });
  }
});

// Create a note. 제목·본문 둘 다 비어있으면 400 (둘 중 하나만 있어도 OK).
app.post('/api/notes', async (req, res) => {
  try {
    const title = (req.body && typeof req.body.title === 'string') ? req.body.title.trim() : '';
    const body = (req.body && typeof req.body.body === 'string') ? req.body.body.trim() : '';
    if (!title && !body) {
      return res.status(400).json({ success: false, message: '제목 또는 내용을 입력해주세요.' });
    }
    const { rows } = await pool.query(
      'INSERT INTO notes (title, body) VALUES ($1, $2) RETURNING id, title, body, created_at',
      [title, body]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('POST /api/notes:', err.message);
    res.status(500).json({ success: false, message: '메모를 추가하지 못했습니다.' });
  }
});

// Update a note (title and/or body). 전달된 필드만 부분 수정합니다.
app.patch('/api/notes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: '잘못된 ID 입니다.' });
    }

    const hasTitle = req.body && typeof req.body.title === 'string';
    const hasBody = req.body && typeof req.body.body === 'string';
    const title = hasTitle ? req.body.title.trim() : null;
    const body = hasBody ? req.body.body.trim() : null;

    if (!hasTitle && !hasBody) {
      return res.status(400).json({ success: false, message: '수정할 내용이 없습니다.' });
    }
    // 제목과 내용을 모두 비우면 빈 메모가 되므로 막습니다 (생성 규칙과 동일).
    if (hasTitle && hasBody && !title && !body) {
      return res.status(400).json({ success: false, message: '제목 또는 내용을 입력해주세요.' });
    }

    const fields = [];
    const values = [];
    let i = 1;
    if (hasTitle) { fields.push(`title = $${i++}`); values.push(title); }
    if (hasBody) { fields.push(`body = $${i++}`); values.push(body); }
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE notes SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, title, body, created_at`,
      values
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 메모를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('PATCH /api/notes/:id:', err.message);
    res.status(500).json({ success: false, message: '메모를 수정하지 못했습니다.' });
  }
});

// Delete one note.
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ success: false, message: '잘못된 ID 입니다.' });
    }
    const { rows } = await pool.query(
      'DELETE FROM notes WHERE id = $1 RETURNING id',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 메모를 찾을 수 없습니다.' });
    }
    res.json({ success: true, data: { id } });
  } catch (err) {
    console.error('DELETE /api/notes/:id:', err.message);
    res.status(500).json({ success: false, message: '메모를 삭제하지 못했습니다.' });
  }
});

// SPA fallback: serve index.html for any non-API GET.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ------------------------------------------------------------
// Local: start server. Serverless (Vercel): export app.
// ------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Notes server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
