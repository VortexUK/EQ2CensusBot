import sqlite3
conn = sqlite3.connect('data/items/items.db')

total = conn.execute('SELECT COUNT(*) FROM items').fetchone()[0]
offset = conn.execute('SELECT value FROM _meta WHERE key=?', ('download_offset',)).fetchone()[0]
print(f'Items in DB : {total:,}')
print(f'Saved offset: {offset}')

mn, mx = conn.execute('SELECT MIN(id), MAX(id) FROM items').fetchone()
print(f'ID range    : {mn:,} – {mx:,}')
print()

# Finer bands covering up to 2^32
bands = [
    (0,              100_000_000),
    (100_000_000,    500_000_000),
    (500_000_000,  1_000_000_000),
    (1_000_000_000,2_000_000_000),
    (2_000_000_000,3_000_000_000),
    (3_000_000_000,4_000_000_000),
    (4_000_000_000,5_000_000_000),
]
print('Item count by ID band:')
for lo, hi in bands:
    cnt = conn.execute('SELECT COUNT(*) FROM items WHERE id>=? AND id<?', (lo, hi)).fetchone()[0]
    if cnt:
        bmn, bmx = conn.execute('SELECT MIN(id), MAX(id) FROM items WHERE id>=? AND id<?', (lo, hi)).fetchone()
        print(f'  {lo/1e6:>8.0f}M – {hi/1e6:>8.0f}M : {cnt:>7,} items  (ids {bmn:,} – {bmx:,})')

# Also check "Written" lines from a progress point of view:
# How many items per 1000-offset bucket were actually stored?
# (We can't do this without timestamps, so show top 20 highest IDs instead)
print()
print('20 highest item IDs in DB:')
rows = conn.execute('SELECT id, displayname FROM items ORDER BY id DESC LIMIT 20').fetchall()
for r in rows:
    print(f'  {r[0]:>15,}  {r[1]}')

conn.close()
