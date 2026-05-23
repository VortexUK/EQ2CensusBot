/**
 * Shared class-name → archetype colour map.
 * Used by HomePage, GuildPage, and any other component that colours
 * characters by their adventure class.
 */
export const CLASS_COLOURS: Record<string, string> = {
  // Fighters
  Guardian: '#f87171', Berserker: '#f87171',
  Paladin: '#f87171', Shadowknight: '#f87171',
  Monk: '#f87171', Bruiser: '#f87171',
  // Scouts
  Ranger: '#fbbf24', Assassin: '#fbbf24',
  Troubador: '#fbbf24', Dirge: '#fbbf24',
  Swashbuckler: '#fbbf24', Brigand: '#fbbf24',
  // Mages
  Wizard: '#93b4ff', Warlock: '#93b4ff',
  Conjuror: '#93b4ff', Necromancer: '#93b4ff',
  Illusionist: '#93b4ff', Coercer: '#93b4ff',
  // Priests
  Templar: '#4ade80', Inquisitor: '#4ade80',
  Mystic: '#4ade80', Defiler: '#4ade80',
  Warden: '#4ade80', Fury: '#4ade80',
  // Beastlord (animalist — scout-adjacent)
  Beastlord: '#fbbf24',
  // Channeler (shaper — mage-adjacent)
  Channeler: '#93b4ff',
}
