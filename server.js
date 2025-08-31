import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static hosting for all of /public
app.use(express.static(path.join(__dirname, "public")));

// Chat pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// Games main page
app.get("/games", (req, res) => {
  res.sendFile(path.join(__dirname, "public/games/index.html"));
});

// API endpoint → list all games
app.get("/api/games", (req, res) => {
  const gamesDir = path.join(__dirname, "public/games/game_uploads");
  const imagesDir = path.join(gamesDir, "images");

  const files = fs.readdirSync(gamesDir).filter(f => f.endsWith(".html"));

  const games = files.map(file => {
    const name = path.parse(file).name;

    // Match any image type
    let image = null;
    const exts = [".jpg", ".jpeg", ".png"];
    for (const ext of exts) {
      if (fs.existsSync(path.join(imagesDir, name + ext))) {
        image = `/games/game_uploads/images/${name + ext}`;
        break;
      }
    }

    return {
      name,
      file: `/games/game_uploads/${file}`,
      image: image || null
    };
  });

  res.json(games);
});

// Catch-all → 404
app.use((req, res) => {
  res.status(404).send("404 Not Found");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
