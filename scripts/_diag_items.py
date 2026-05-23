import sqlite3

conn = sqlite3.connect("data/items/items.db")

print("=== All distinct stat names in item_stats ===")
for r in conn.execute("SELECT stat, COUNT(*) as n FROM item_stats GROUP BY stat ORDER BY n DESC"):
    print(f"  {r[1]:6d}  {r[0]!r}")

conn.close()
