// ------------------- Imports -------------------
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const path = require("path");
const axios = require("axios");
import type { Request, Response } from "express";

// ------------------- App setup -------------------
const app = express();
const PORT = 5001;

// ------------------- Config -------------------
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "root";
const DB_PASS = process.env.DB_PASS || "";
const DB_NAME = process.env.DB_NAME || "notes_app";

const CLIENT_ID = process.env.CLIENT_ID || "";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "";
const REDIRECT_URI = process.env.REDIRECT_URI || "http://localhost:5001/oauth/callback";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ------------------- Middleware -------------------
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

// ------------------- Auth -------------------
// Register
app.post("/auth/register", (req: Request, res: Response) => {
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

// Login
app.post("/auth/login", (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Missing fields" });

  db.query("SELECT * FROM users WHERE email = ?", [email], (err: any, rows: any) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!rows.length) return res.status(401).json({ message: "User not found" });
    if (rows[0].password !== password) return res.status(401).json({ message: "Wrong password" });

    res.json({ success: true, user: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
  });
});

// Google OAuth
app.get("/login", (req: Request, res: Response) => {
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    "&response_type=code&scope=openid%20email%20profile&access_type=offline";
  res.redirect(url);
});

app.get("/oauth/callback", async (req: Request, res: Response) => {
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

    db.query(
      "INSERT INTO users (google_id, name, email, picture) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=?, email=?, picture=?",
      [g.id, g.name, g.email, g.picture, g.name, g.email, g.picture],
      () => {
        const redirectUrl = `${FRONTEND_URL}/?google_id=${g.id}&name=${encodeURIComponent(g.name)}&email=${encodeURIComponent(
          g.email
        )}&picture=${encodeURIComponent(g.picture)}`;
        res.redirect(redirectUrl);
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth error");
  }
});

// ------------------- Notes CRUD -------------------

// Get all notes for a user
app.get("/notes", (req: Request, res: Response) => {
  const { user_id, google_id } = req.query;
  if (!user_id && !google_id) return res.status(400).json({ error: "Missing user identifier" });

  db.query(
    "SELECT * FROM notes WHERE user_id=? OR google_id=?",
    [user_id || null, google_id || null],
    (err: any, result: any[]) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(result);
    }
  );
});

// Add note
app.post("/notes", (req: Request, res: Response) => {
  const { user_id, google_id, title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Title/content required" });

  db.query(
    "INSERT INTO notes (user_id, google_id, title, content) VALUES (?, ?, ?, ?)",
    [user_id || null, google_id || null, title, content],
    (err: any, result: any) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, noteId: result.insertId });
    }
  );
});

// Update note
app.put("/notes/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Title/content required" });

  db.query("UPDATE notes SET title=?, content=? WHERE id=?", [title, content, id], (err: any, result: any) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// Delete note
app.delete("/notes/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  db.query("DELETE FROM notes WHERE id=?", [id], (err: any, result: any) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ------------------- Serve React -------------------
const buildPath = path.join(__dirname, "frontend", "build");
app.use(express.static(buildPath));
app.get("/:path", (req: Request, res: Response) => res.sendFile(path.join(buildPath, "index.html")));

// ------------------- Start server -------------------
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
