// Warcraft-Logs-style percentile colour scale. Distinct from rarityColors.ts
// (item quality) on purpose — this is a performance percentile, not item tier.

export function percentileColor(p: number): string {
  if (p >= 100) return '#e5cc80' // gold
  if (p >= 99) return '#e268a8'  // pink
  if (p >= 95) return '#ff8000'  // orange
  if (p >= 75) return '#a335ee'  // purple
  if (p >= 50) return '#0070ff'  // blue
  if (p >= 25) return '#1eff00'  // green
  return '#666666'               // grey
}
