import React, { useEffect, useState } from "react";

// ------------------------------------------------------------------------------------------------
// CRITICAL FIX: Replace "http://localhost:5001" with your LIVE Render Backend URL.
// The REACT_APP_API_URL should be set in your frontend build process or hardcoded here
// as the frontend is built once and doesn't get Render Environment variables.
// Use the URL of your Render Web Service (e.g., https://your-backend-name.onrender.com/api)
// Assuming your backend routes start with /api, include that prefix.
// ------------------------------------------------------------------------------------------------
const API = process.env.REACT_APP_API_URL || "https://notes-api-server-itk9.onrender.com/api";

type User = {
    id?: number;      
    google_id?: string; 
    name: string;
    email: string;
    picture?: string;
};

type Note = {
    id: number;
    user_id?: number;
    google_id?: string;
    title: string;
    content: string;
};

function App() {
    const [user, setUser] = useState<User | null>(null);
    const [notes, setNotes] = useState<Note[]>([]);
    const [noteTitle, setNoteTitle] = useState("");
    const [noteContent, setNoteContent] = useState("");
    const [editId, setEditId] = useState<number | null>(null);
    const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "" });
    const [loginForm, setLoginForm] = useState({ email: "", password: "" });

    // Check if redirected from Google OAuth
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const google_id = params.get("google_id");
        if (google_id) {
            setUser({
                google_id,
                name: params.get("name") || "",
                email: params.get("email") || "",
                picture: params.get("picture") || "",
            });
            window.history.replaceState({}, document.title, "/");
        }
    }, []);

    useEffect(() => {
        if (!user) return;
        fetch(`${API}/notes?user_id=${user.id || ""}&google_id=${user.google_id || ""}`)
          .then((res) => res.json())
          .then((data) => setNotes(data));
    }, [user]);

    const handleRegister = async () => {
        const res = await fetch(`${API}/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(registerForm),
        });
        const data = await res.json();
        if (data.success) setUser(data.user);
        else alert(data.message);
    };

    const handleLogin = async () => {
        const res = await fetch(`${API}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(loginForm),
        });
        const data = await res.json();
        if (data.success) setUser(data.user);
        else alert(data.message);
    };

    const handleLogout = () => {
        setUser(null);
        setNotes([]);
    };

    const handleAddOrEditNote = async () => {
        if (!noteTitle || !noteContent) return alert("Fill all fields");

        if (editId) {
            // Update existing note
            const res = await fetch(`${API}/notes/${editId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: noteTitle, content: noteContent }),
            });
            const data = await res.json();
            if (data.success) {
                // FIXED TS7006: parameter 'n' implicitly has an 'any' type.
                setNotes(notes.map((n: Note) => (n.id === editId ? { ...n, title: noteTitle, content: noteContent } : n))); 
                setEditId(null);
                setNoteTitle("");
                setNoteContent("");
            } else alert(data.error);
        } else {
            // Add new note
            const res = await fetch(`${API}/notes`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: noteTitle,
                    content: noteContent,
                    user_id: user?.id || null,
                    google_id: user?.google_id || null,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setNotes([...notes, { id: data.noteId, title: noteTitle, content: noteContent, user_id: user?.id, google_id: user?.google_id }]);
                setNoteTitle("");
                setNoteContent("");
            } else alert(data.error);
        }
    };

    const handleEdit = (note: Note) => {
        setEditId(note.id);
        setNoteTitle(note.title);
        setNoteContent(note.content);
    };

    const handleDeleteNote = async (id: number) => {
        await fetch(`${API}/notes/${id}`, { method: "DELETE" });
        // FIXED TS7006: parameter 'n' implicitly has an 'any' type.
        setNotes(notes.filter((n: Note) => n.id !== id));
    };

    if (!user)
        return (
            <div style={{ fontFamily: "Arial, sans-serif", maxWidth: 500, margin: "50px auto", textAlign: "center" }}>
                <h1>TAKE NOTE!</h1>
                  <h3>Jemmy Lim II</h3>

                <div style={{ marginBottom: 30 }}>
                    <h2>Register</h2>
                    <input placeholder="Name" style={inputStyle} value={registerForm.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRegisterForm({ ...registerForm, name: e.target.value })} />
                    <input placeholder="Email" style={inputStyle} value={registerForm.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRegisterForm({ ...registerForm, email: e.target.value })} />
                    <input type="password" placeholder="Password" style={inputStyle} value={registerForm.password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRegisterForm({ ...registerForm, password: e.target.value })} />
                    <button style={buttonStyle} onClick={handleRegister}>Register</button>
                </div>

                <div style={{ marginBottom: 30 }}>
                    <h2>Login</h2>
                    <input placeholder="Email" style={inputStyle} value={loginForm.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLoginForm({ ...loginForm, email: e.target.value })} />
                    <input type="password" placeholder="Password" style={inputStyle} value={loginForm.password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLoginForm({ ...loginForm, password: e.target.value })} />
                    <button style={buttonStyle} onClick={handleLogin}>Login</button>
                </div>

                <div>
                    <h2>Or login with Google</h2>
                    <a href={`${API}/login`}> {/* Added missing /auth prefix */}
                        <button style={{ ...buttonStyle, backgroundColor: "#4285F4", color: "#fff" }}>Login with Google</button>
                    </a>
                </div>
            </div>
        );

    return (
        <div style={{ fontFamily: "Arial, sans-serif", maxWidth: 800, margin: "50px auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h1>Welcome, {user.name}</h1>
                {user.picture && <img src={user.picture} alt="profile" width={60} style={{ borderRadius: "50%" }} />}
                <button style={buttonStyle} onClick={handleLogout}>Logout</button>
            </div>

            <div style={{ marginTop: 20, padding: 20, border: "1px solid #ccc", borderRadius: 10, backgroundColor: "#f9f9f9" }}>
                <h2>{editId ? "Edit Note" : "Add Note"}</h2>
                <input placeholder="Title" style={inputStyle} value={noteTitle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNoteTitle(e.target.value)} />
                <textarea placeholder="Content" style={{ ...inputStyle, height: 80 }} value={noteContent} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNoteContent(e.target.value)} />
                <button style={buttonStyle} onClick={handleAddOrEditNote}>{editId ? "Update Note" : "Add Note"}</button>
                {editId && <button style={{ ...buttonStyle, backgroundColor: "#888" }} onClick={() => { setEditId(null); setNoteTitle(""); setNoteContent(""); }}>Cancel</button>}
            </div>

            <h2 style={{ marginTop: 40 }}>Your Notes</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 20 }}>
                {notes.map((n: Note) => ( // FIXED TS7006
                    <div key={n.id} style={{ border: "1px solid #ccc", padding: 15, borderRadius: 10, backgroundColor: "#fff" }}>
                        <h3>{n.title}</h3>
                        <p>{n.content}</p>
                        <div style={{ display: "flex", gap: 10 }}>
                            <button style={buttonStyle} onClick={() => handleEdit(n)}>Edit</button>
                            <button style={{ ...buttonStyle, backgroundColor: "#e74c3c" }} onClick={() => handleDeleteNote(n.id)}>Delete</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Reusable styling
const inputStyle = { display: "block", width: "100%", padding: 10, margin: "10px 0", borderRadius: 6, border: "1px solid #ccc" };
const buttonStyle = { padding: "10px 16px", borderRadius: 6, border: "none", backgroundColor: "#2ecc71", color: "#fff", cursor: "pointer" };

export default App;