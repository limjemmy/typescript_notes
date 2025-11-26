const express = require("express");
const cors = require("cors");
// CHANGE 1: Use PostgreSQL driver instead of MySQL
const { Pool } = require("pg"); 
const axios = require("axios");

import type { Request, Response } from "express";

const app = express();
// Listen on the port provided by the environment, or default to 8080 
const PORT = process.env.PORT || 8080; 

// ------------------- Config -------------------
// CHANGE 2: We no longer need DB_HOST/USER/PASS/NAME. We use the single DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL!;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.REDIRECT_URI!; 
const FRONTEND_URL = process.env.FRONTEND_URL!;

// ------------------- Middleware -------------------
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

// ------------------- PostgreSQL connection -------------------
const pool = new Pool({
    // CHANGE 3: Use the single DATABASE_URL provided by Render
    connectionString: DATABASE_URL,
    // Required for Render's external connections, but often helpful internally too
    ssl: {
        rejectUnauthorized: false
    }
});

// CHANGE 4: Connect using the pool and check status
pool.connect((err: any) => {
    if (err) console.error("DB connection failed:", err);
    else console.log("DB connected successfully!");
});

// Helper function to handle queries with Postgres
const dbQuery = async (sql: string, params: any[] = []) => {
    try {
        const result = await pool.query(sql, params);
        // Postgres returns 'rows' instead of a generic result
        return result.rows;
    } catch (err: any) {
        console.error("SQL Error:", err.message);
        throw err;
    }
};


// ------------------- API Router Setup -------------------
const apiRouter = express.Router();


// ------------------- Auth Routes -------------------

// Register -> /api/auth/register
apiRouter.post("/auth/register", async (req: Request, res: Response) => {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Missing fields" });

    try {
        // CHANGE 5: Use $1, $2, $3 for parameterized queries
        const insertSql = "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id";
        const result = await pool.query(insertSql, [name, email, password]);
        
        // Postgres returns the inserted ID in the result rows via RETURNING
        const insertId = result.rows[0].id;

        const selectSql = "SELECT id, name, email FROM users WHERE id = $1";
        const rows = await dbQuery(selectSql, [insertId]);
        
        res.json({ success: true, user: rows[0] });

    } catch (err: any) {
        return res.status(500).json({ message: err.message });
    }
});

// Login -> /api/auth/login
apiRouter.post("/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Missing fields" });

    try {
        const sql = "SELECT * FROM users WHERE email = $1"; // CHANGE 5
        const rows = await dbQuery(sql, [email]);

        if (!rows.length) return res.status(401).json({ message: "User not found" });
        if (rows[0].password !== password) return res.status(401).json({ message: "Wrong password" });

        res.json({ success: true, user: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
    } catch (err: any) {
        return res.status(500).json({ message: err.message });
    }
});

// ------------------- Google OAuth Routes -------------------

// Redirect to Google -> /api/login
apiRouter.get("/login", (req: Request, res: Response) => {
    // ... [No changes needed here]
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

        // CHANGE 6: Postgres requires different syntax for ON CONFLICT (ON DUPLICATE KEY UPDATE)
        const upsertSql = `
            INSERT INTO users (google_id, name, email, picture) 
            VALUES ($1, $2, $3, $4) 
            ON CONFLICT (google_id) DO UPDATE SET 
                name = $5, email = $6, picture = $7
        `;
        // NOTE: The (google_id) in ON CONFLICT requires a UNIQUE index on the google_id column 
        // in your PostgreSQL database schema. If you haven't added that, we need to do so.

        await pool.query(
            upsertSql, 
            [g.id, g.name, g.email, g.picture, g.name, g.email, g.picture]
        );

        const redirectUrl = `${FRONTEND_URL}/?google_id=${g.id}&name=${encodeURIComponent(
            g.name
        )}&email=${encodeURIComponent(g.email)}&picture=${encodeURIComponent(g.picture)}`;
        res.redirect(redirectUrl);

    } catch (err: any) {
        console.error(err);
        res.status(500).send("OAuth error");
    }
});

// ------------------- Notes CRUD Routes -------------------

// Get notes -> /api/notes
apiRouter.get("/notes", async (req: Request, res: Response) => {
    const { user_id, google_id } = req.query;
    if (!user_id && !google_id) return res.status(400).json({ error: "Missing user identifier" });

    try {
        // CHANGE 7: Use $1, $2 for parameters
        const sql = "SELECT * FROM notes WHERE user_id=$1 OR google_id=$2";
        const result = await dbQuery(sql, [user_id || null, google_id || null]);
        res.json(result);
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// Add note -> /api/notes
apiRouter.post("/notes", async (req: Request, res: Response) => {
    const { google_id, user_id, title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Title/content required" });

    const uid = user_id && Number(user_id) > 0 ? user_id : null;

    try {
        // CHANGE 7: Use $1, $2, $3, $4 for parameters and RETURNING id
        const sql = "INSERT INTO notes (google_id, user_id, title, content) VALUES ($1, $2, $3, $4) RETURNING id";
        const result = await pool.query(sql, [google_id || null, uid, title, content]);
        
        res.json({ success: true, noteId: result.rows[0].id });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// Update note -> /api/notes/:id
apiRouter.put("/notes/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Title/content required" });

    try {
        // CHANGE 7: Use $1, $2, $3 for parameters
        const sql = "UPDATE notes SET title=$1, content=$2 WHERE id=$3";
        await pool.query(sql, [title, content, id]);
        res.json({ success: true });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// Delete note -> /api/notes/:id
apiRouter.delete("/notes/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    
    try {
        const sql = "DELETE FROM notes WHERE id=$1"; // CHANGE 7
        await pool.query(sql, [id]);
        res.json({ success: true });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

// ------------------- BIND ALL API ROUTES -------------------
app.use('/api', apiRouter);


// ------------------- Start server -------------------
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on internal port ${PORT}`));