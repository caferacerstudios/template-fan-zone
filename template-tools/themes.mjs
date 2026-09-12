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

// Fan-site palettes: light accents on dark surfaces, darker links on paper.
// Status colors are deliberately outside this brand-only mapping.
function fanPalette({ darkest, dark, surface, accent, light, focus, link, wash, tint, border }) {
  return {
    '#031525': darkest, '#071f34': dark, '#0b2d49': surface,
    '#70c934': accent, '#69be28': accent, '#83da47': light, '#9be65c': focus,
    ...Object.fromEntries([
      '#2f660b', '#315f12', '#386f13', '#397a12', '#398000',
      '#41651b', '#4b711f', '#4d861e', '#285d08',
    ].map(color => [color, link])),
    '#edf6e8': wash, '#dfeeda': tint, '#c9e7b5': border,
  };
}

const packersPalette = fanPalette({
  darkest: '#142820', dark: '#2a433a', surface: '#36594b',
  accent: '#ffb612', light: '#ffce59', focus: '#ffdf91', link: '#305a40',
  wash: '#f3f6ed', tint: '#e4edda', border: '#c7d8b7',
});
const vikingsPalette = fanPalette({
  darkest: '#23123d', dark: '#4f2683', surface: '#5e3990',
  accent: '#ffc62f', light: '#ffda73', focus: '#ffe59c', link: '#633992',
  wash: '#f4f0f9', tint: '#e9dff3', border: '#d5bfe9',
});
const chiefsPalette = fanPalette({
  darkest: '#400916', dark: '#8f1028', surface: '#b5122d',
  accent: '#ffb81c', light: '#ffd06b', focus: '#ffe39b', link: '#b5122d',
  wash: '#fff1f2', tint: '#fbdde2', border: '#f2b9c3',
});

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
  packers: {
    key: 'packers', stylesheet: '/styles/themes/packers.css',
    favicon: '/favicons/packers.svg', palette: packersPalette,
    brandMark: 'PFZ', heroMark: 'GB',
    fanTagline: 'Independent football coverage for Packers fans.',
  },
  vikings: {
    key: 'vikings', stylesheet: '/styles/themes/vikings.css',
    favicon: '/favicons/vikings.svg', palette: vikingsPalette,
    brandMark: 'VFZ', heroMark: 'MIN',
    fanTagline: 'Independent football coverage for Vikings fans.',
  },
  chiefs: {
    key: 'chiefs', stylesheet: '/styles/themes/chiefs.css',
    favicon: '/favicons/chiefs.svg', palette: chiefsPalette,
    brandMark: 'CFZ', heroMark: 'KC',
    fanTagline: 'Independent football coverage for Chiefs fans.',
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
