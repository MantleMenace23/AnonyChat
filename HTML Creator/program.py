import tkinter as tk
from tkinter import filedialog, messagebox
import os
import base64

# Create main window
root = tk.Tk()
root.title("AnonyChat Game HTML Generator")
root.geometry("500x400")
root.configure(bg="#1e1e2f")

# Store file paths and title
game_html_path = tk.StringVar()
cover_image_path = tk.StringVar()
game_title = tk.StringVar()
output_folder = tk.StringVar()

def select_game_html():
    path = filedialog.askopenfilename(filetypes=[("HTML Files", "*.html")])
    if path:
        game_html_path.set(path)

def select_cover_image():
    path = filedialog.askopenfilename(filetypes=[("Image Files", "*.png;*.jpg;*.jpeg;*.webp")])
    if path:
        cover_image_path.set(path)

def select_output_folder():
    folder = filedialog.askdirectory()
    if folder:
        output_folder.set(folder)

def generate_html():
    if not game_html_path.get() or not cover_image_path.get() or not game_title.get() or not output_folder.get():
        messagebox.showerror("Error", "Please select all fields before generating.")
        return

    # Read game HTML content
    with open(game_html_path.get(), "r", encoding="utf-8") as f:
        game_content = f.read()

    # Encode cover image as base64
    with open(cover_image_path.get(), "rb") as f:
        image_data = f.read()
        encoded_image = base64.b64encode(image_data).decode("utf-8")
        ext = os.path.splitext(cover_image_path.get())[1].lower()[1:]
        img_src = f"data:image/{ext};base64,{encoded_image}"

    # Build final HTML
    final_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{game_title.get()}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
body {{
  margin: 0;
  background: #1e1e2f;
  color: white;
  font-family: 'Inter', sans-serif;
}}
.game-container {{
  max-width: 800px;
  margin: 20px auto;
  background: #2a2a40;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  text-align: center;
}}
.game-cover {{
  width: 200px;
  border-radius: 12px;
}}
iframe {{
  width: 100%;
  height: 500px;
  border: none;
  margin-top: 20px;
}}
</style>
</head>
<body>
<div class="game-container">
  <h1 class="text-2xl font-bold mb-4">{game_title.get()}</h1>
  <img src="{img_src}" class="game-cover" alt="Cover image">
  <div>
    <iframe srcdoc="{game_content.replace('"', '&quot;').replace('\n',' ')}"></iframe>
  </div>
</div>
</body>
</html>
"""

    # Save file
    safe_title = "".join(c for c in game_title.get() if c.isalnum() or c in (' ', '-', '_')).rstrip()
    output_path = os.path.join(output_folder.get(), f"{safe_title}.html")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(final_html)

    messagebox.showinfo("Success", f"Generated HTML file at:\n{output_path}")

# GUI Layout
tk.Label(root, text="Game Title", bg="#1e1e2f", fg="white").pack(pady=(20,5))
tk.Entry(root, textvariable=game_title, width=50).pack()

tk.Label(root, text="Game HTML File", bg="#1e1e2f", fg="white").pack(pady=(20,5))
tk.Entry(root, textvariable=game_html_path, width=50).pack()
tk.Button(root, text="Select HTML File", command=select_game_html, bg="#4facfe", fg="white").pack(pady=5)

tk.Label(root, text="Cover Image", bg="#1e1e2f", fg="white").pack(pady=(20,5))
tk.Entry(root, textvariable=cover_image_path, width=50).pack()
tk.Button(root, text="Select Image", command=select_cover_image, bg="#4facfe", fg="white").pack(pady=5)

tk.Label(root, text="Output Folder", bg="#1e1e2f", fg="white").pack(pady=(20,5))
tk.Entry(root, textvariable=output_folder, width=50).pack()
tk.Button(root, text="Select Output Folder", command=select_output_folder, bg="#4facfe", fg="white").pack(pady=5)

tk.Button(root, text="Generate HTML", command=generate_html, bg="#00f2fe", fg="white", font=("Inter", 14, "bold")).pack(pady=20)

root.mainloop()
