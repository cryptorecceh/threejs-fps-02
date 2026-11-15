// Dustline Yard — look plan. Warm sand, dark steel, one amber accent; the two teams
// read as blue (Vipers, the player's side) against orange (Jackals). Every colour in
// the game comes from these names; the same names are the CSS custom properties.
export const PALETTE = {
  canvas: '#1a140d',
  surface: '#2b241a',
  hairline: '#4a3f2c',
  ink: '#efe7d6',
  muted: '#a89a7c',
  accent: '#f0a830',
  sand: '#c9a86a',
  steel: '#3d4a55',
  rust: '#8a4b2a',
  viper: '#3f7fd0',
  jackal: '#e07020',
};

export function shade(name) {
  return PALETTE[name];
}
