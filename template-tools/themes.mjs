// Build-time presentation only. Data IDs, feeds and factual content are separate.
// Palette keys are existing brand colors; semantic success/loss colors are omitted.
const broncosPalette = {
  '#031525': '#07172f', '#071f34': '#002244', '#0b2d49': '#12345a',
  '#70c934': '#fb4f14', '#69be28': '#fb4f14', '#83da47': '#ff7847',
  '#9be65c': '#ffab85',
  '#2f660b': '#a6310a', '#315f12': '#a6310a', '#386f13': '#a6310a',
  '#397a12': '#a6310a', '#398000': '#a6310a', '#41651b': '#a6310a',
  '#4b711f': '#a6310a', '#4d861e': '#a6310a', '#285d08': '#a6310a',
  '#edf6e8': '#fff0e8', '#dfeeda': '#ffe2d2', '#c9e7b5': '#ffd3bd',
};

export const TEAM_THEMES = {
  seahawks: {
    key: 'seahawks', stylesheet: '', favicon: '', palette: {},
    brandMark: 'SFZ', heroMark: '12',
    fanTagline: 'Independent football coverage for the 12s.',
  },
  broncos: {
    key: 'broncos', stylesheet: '/styles/themes/broncos.css',
    favicon: '/favicons/broncos.svg', palette: broncosPalette,
    brandMark: 'BFZ', heroMark: 'DEN',
    fanTagline: 'Independent football coverage for Broncos fans.',
  },
};

export function themeSettings(slug) {
  if (Object.hasOwn(TEAM_THEMES, slug)) return TEAM_THEMES[slug];
  // Other teams keep the shared base palette until their theme is designed.
  const name = slug[0].toUpperCase() + slug.slice(1);
  return { key: 'default', stylesheet: '', favicon: '', palette: {},
    brandMark: `${slug[0].toUpperCase()}FZ`, heroMark: 'FZ',
    fanTagline: `Independent football coverage for ${name} fans.` };
}

export function renderThemeCss(css, theme) {
  if (!Object.keys(theme.palette).length) return css;
  // Preserve the alpha channel on existing eight-digit brand colors.
  let result = css.replace(/#[a-f\d]{8}\b|#[a-f\d]{6}\b/gi, (color) => {
    const key = color.slice(0, 7).toLowerCase();
    return theme.palette[key] ? theme.palette[key] + color.slice(7) : color;
  });
  // Old header/card accent washes use both versions of the Seahawks green.
  for (const oldColor of ['#70c934', '#69be28']) {
    const newColor = theme.palette[oldColor];
    if (!newColor) continue;
    const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const pattern = new RegExp(`(rgba?\\(\\s*)${rgb(oldColor).join('\\s*,\\s*')}(?=\\s*[,\\)])`, 'gi');
    result = result.replace(pattern, (_, start) => start + rgb(newColor).join(','));
  }
  return result;
}

export function renderThemeStyles(text, relative, theme) {
  // Dedicated team styles are already authored in their final palette.
  if (relative.replaceAll('\\', '/').startsWith('public/styles/themes/')) return text;
  if (relative.endsWith('.css')) return renderThemeCss(text, theme);
  if (!/\.(astro|html|mdx)$/.test(relative)) return text;
  // Only styles are recolored, never JS/data values or article prose.
  return text.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, open, css, close) => open + renderThemeCss(css, theme) + close);
}
