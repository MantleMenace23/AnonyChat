import tkinter as tk
from tkinter import filedialog, messagebox
from pathlib import Path

# --------------------
# Functions
# --------------------
def select_image():
    filepath = filedialog.askopenfilename(
        title="Select Cover Image",
        filetypes=[("Image Files", "*.png *.jpg *.jpeg *.webp")]
    )
    if filepath:
        image_path_var.set(filepath)

def generate_html():
    name = name_var.get().strip()
    cover = image_path_var.get().strip()
    html_code = game_html_text.get("1.0", tk.END).strip()

    if not name or not cover or not html_code:
        messagebox.showerror("Error", "Please fill all fields and select an image.")
        return

    # Prepare output HTML template
    output_html = f"""
<div class="game-tile cursor-pointer hover:scale-105 transition transform rounded-xl overflow-hidden shadow-lg bg-slate-900">
  <div class="relative h-40 w-full">
    <img src="{cover}" alt="{name}" class="object-cover w-full h-full">
  </div>
  <div class="p-2">
    <h3 class="text-center text-white font-semibold truncate">{name}</h3>
    <div class="hidden game-html">{html_code.replace('"', '&quot;')}</div>
  </div>
</div>
"""

    # Ask where to save
    save_path = filedialog.asksaveasfilename(
        title="Save Game HTML",
        defaultextension=".html",
        filetypes=[("HTML Files", "*.html")],
        initialfile=name.replace(" ", "_")
    )
    if save_path:
        with open(save_path, "w", encoding="utf-8") as f:
            f.write(output_html)
        messagebox.showinfo("Success", f"Game HTML saved to:\n{save_path}")

# --------------------
# GUI Setup
# --------------------
root = tk.Tk()
root.title("AnonyChat Game Builder")
root.geometry("600x600")
root.resizable(False, False)

# Variables
name_var = tk.StringVar()
image_path_var = tk.StringVar()

# Widgets
tk.Label(root, text="Game Name:", font=("Arial", 12)).pack(anchor="w", padx=10, pady=(10,0))
tk.Entry(root, textvariable=name_var, font=("Arial", 12)).pack(fill="x", padx=10)

tk.Label(root, text="Cover Image:", font=("Arial", 12)).pack(anchor="w", padx=10, pady=(10,0))
tk.Frame(root).pack(pady=5)
tk.Button(root, text="Select Image", command=select_image, font=("Arial", 12)).pack(padx=10, pady=0)
tk.Label(root, textvariable=image_path_var, font=("Arial", 10), fg="gray").pack(anchor="w", padx=10)

tk.Label(root, text="Game HTML Code:", font=("Arial", 12)).pack(anchor="w", padx=10, pady=(10,0))
game_html_text = tk.Text(root, height=20, font=("Arial", 10))
game_html_text.pack(fill="both", padx=10, pady=(0,10), expand=True)

tk.Button(root, text="Generate Game HTML", font=("Arial", 14), bg="#4facfe", fg="white", command=generate_html).pack(pady=10)

root.mainloop()
