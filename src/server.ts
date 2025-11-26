const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

import type { Request, Response } from "express";

const app = express();
// Listen on the port provided by the environment, or default to 8080 
// (a common port for internal Node.js processes on shared hosting).
const PORT = process.env.PORT || 8080; 

// ------------------- Config -------------------
const DB_HOST = process.env.DB_HOST!;
const DB_USER = process.env.DB_USER!;
const DB_PASS = process.env.DB_PASS!;
const DB_NAME = process.env.DB_NAME!;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
// Note: REDIRECT_URI should be the full Hostinger URL + /api/oauth/callback
const REDIRECT_URI = process.env.REDIRECT_URI!; 
const FRONTEND_URL = process.env.FRONTEND_URL!;

// ------------------- Middleware -------------------
// The FRONTEND_URL will be your main domain (e.g., https://yourdomain.com)
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

// ------------------- MySQL connection -------------------
const db = mysql.createConnection({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
});

db.connect((err: any) => {
  if (err) console.error("DB connection failed:", err);
  else console.log("DB connected!");
});

// ------------------- API Router Setup -------------------
// All routes defined below will automatically be prefixed with /api
const apiRouter = express.Router();


// ------------------- Auth Routes -------------------

// Register -> /api/auth/register
apiRouter.post("/auth/register", (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Missing fields" });

  db.query(
    "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
    [name, email, password],
    (err: any, result: any) => {
      if (err) return res.status(500).json({ message: err.message });

      db.query("SELECT id, name, email FROM users WHERE id = ?", [result.insertId], (err: any, rows: any) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json({ success: true, user: rows[0] });
      });
    }
  );
});

// Login -> /api/auth/login
apiRouter.post("/auth/login", (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Missing fields" });

  db.query("SELECT * FROM users WHERE email = ?", [email], (err: any, rows: any) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!rows.length) return res.status(401).json({ message: "User not found" });
    if (rows[0].password !== password) return res.status(401).json({ message: "Wrong password" });

    res.json({ success: true, user: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
  });
});

// ------------------- Google OAuth Routes -------------------

// Redirect to Google -> /api/login
apiRouter.get("/login", (req: Request, res: Response) => {
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    "&response_type=code&scope=openid%20email%20profile&access_type=offline";
  res.redirect(url);
});

// OAuth Callback -> /api/oauth/callback
apiRouter.get("/oauth/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) return res.status(400).send("No code");

  try {
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const access_token = tokenRes.data.access_token;
    const userRes = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const g = userRes.data;

    // Insert or update user
    db.query(
      "INSERT INTO users (google_id, name, email, picture) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, email=?, picture=?",
      [g.id, g.name, g.email, g.picture, g.name, g.email, g.picture],
      (err: any) => {
        if (err) return res.status(500).send("DB error");

        const redirectUrl = `${FRONTEND_URL}/?google_id=${g.id}&name=${encodeURIComponent(
          g.name
        )}&email=${encodeURIComponent(g.email)}&picture=${encodeURIComponent(g.picture)}`;
        res.redirect(redirectUrl);
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth error");
  }
});

// ------------------- Notes CRUD Routes -------------------

// Get notes -> /api/notes
apiRouter.get("/notes", (req: Request, res: Response) => {
  const { user_id, google_id } = req.query;
  if (!user_id && !google_id) return res.status(400).json({ error: "Missing user identifier" });

  const sql = "SELECT * FROM notes WHERE user_id=? OR google_id=?";
  db.query(sql, [user_id || null, google_id || null], (err: any, result: any[]) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// Add note -> /api/notes
apiRouter.post("/notes", (req: Request, res: Response) => {
  const { google_id, user_id, title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Title/content required" });

  const uid = user_id && Number(user_id) > 0 ? user_id : null;

  db.query(
    "INSERT INTO notes (google_id, user_id, title, content) VALUES (?, ?, ?, ?)",
    [google_id || null, uid, title, content],
    (err: any, result: any) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, noteId: result.insertId });
    }
  );
});

// Update note -> /api/notes/:id
apiRouter.put("/notes/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Title/content required" });

  db.query("UPDATE notes SET title=?, content=? WHERE id=?", [title, content, id], (err: any) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Delete note -> /api/notes/:id
apiRouter.delete("/notes/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  db.query("DELETE FROM notes WHERE id=?", [id], (err: any) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ------------------- BIND ALL API ROUTES -------------------
// All routes above are now accessed via /api/...
app.use('/api', apiRouter);


// ------------------- DELETE: Removed Static Serve Block -------------------
// The section for serving React static files and the catch-all route 
// has been removed. Hostinger's web server will handle the frontend 
// directly from public_html.

// ------------------- Start server -------------------
app.listen(PORT, () => console.log(`Server running on internal port ${PORT}`));