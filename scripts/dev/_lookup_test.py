import sqlite3

conn = sqlite3.connect("data/items/items.db")
rows = conn.execute(
    "SELECT id, displayname FROM items WHERE displayname_lower LIKE ?", ("%bloodthirsty choker%",)
).fetchall()
print("DB results:", rows)
conn.close()
