import sqlite3
conn = sqlite3.connect('data/items/items.db')

page_size  = conn.execute('PRAGMA page_size').fetchone()[0]
page_count = conn.execute('PRAGMA page_count').fetchone()[0]
free_pages = conn.execute('PRAGMA freelist_count').fetchone()[0]
print(f'Page size   : {page_size:,} bytes')
print(f'Total pages : {page_count:,}')
print(f'Free pages  : {free_pages:,}')
print(f'DB size est : {page_size * page_count / 1024**2:.1f} MB')
print(f'Reclaimable : {page_size * free_pages / 1024**2:.1f} MB  (VACUUM would recover this)')
print()

rows = conn.execute('''
    SELECT raw_json, typeinfo_json, modifiers_json, effect_list_json,
           adornment_slots_json, adornment_list_json, classification_json,
           slot_list_json, setbonus_list_json, flags_json, classes_json
    FROM items ORDER BY RANDOM() LIMIT 500
''').fetchall()

cols = [
    'raw_json', 'typeinfo_json', 'modifiers_json', 'effect_list_json',
    'adornment_slots_json', 'adornment_list_json', 'classification_json',
    'slot_list_json', 'setbonus_list_json', 'flags_json', 'classes_json',
]

n = 127_841
print('Avg bytes per row (500-row sample) + projected total:')
total = 0
for i, col in enumerate(cols):
    avg = sum(len(r[i] or '') for r in rows) / len(rows)
    est = avg * n / 1024**2
    total += avg
    print(f'  {col:<32} {avg:>8.0f} B avg   ~{est:>5.0f} MB')
print(f'  {"TOTAL (json cols)":<32} {total:>8.0f} B avg   ~{total * n / 1024**2:>5.0f} MB')
conn.close()
