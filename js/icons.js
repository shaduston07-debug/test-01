// Inline SVG icons (24×24, stroke = currentColor)
const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const ICONS = {
  actions: s('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a1.8 1.8 0 1 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.4-.4-2.4z"/>'),
  adjust: s('<path d="M4 20 14 10M15 3l1 2.5L18.5 6.5 16 7.5 15 10l-1-2.5L11.5 6.5 14 5.5zM19 12l.6 1.4L21 14l-1.4.6L19 16l-.6-1.4L17 14l1.4-.6z"/>'),
  select: s('<path d="M5 6c3-3 11-3 14 0s-1 9-6 9c-2 0-3 1-3 3" stroke-dasharray="3 2.4"/><circle cx="10" cy="19.5" r="1.5"/>'),
  transform: s('<path d="M5 3 18 11l-6 1.5-3 6z"/>'),
  fill: s('<path d="M4 12 11 5l7 7-6 6a2 2 0 0 1-2.8 0L4 12.8zM4 12h14M8 3l3 2"/><path d="M20 15s-2 2.4-2 3.6a2 2 0 0 0 4 0C22 17.4 20 15 20 15z"/>'),
  eyedropper: s('<path d="m14 4 6 6M17 2.5a2.1 2.1 0 0 1 3 3L17 8.5l-2-2zM15 7.5 5.5 17v2.5H8l9.5-9.5"/>'),
  panel: s('<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 11h18M12 11v10"/>'),
  balloon: s('<path d="M12 4c5 0 9 2.9 9 6.5S17 17 12 17c-.9 0-1.8-.1-2.6-.3L5 19.5l1.2-3.6C4.2 14.7 3 12.7 3 10.5 3 6.9 7 4 12 4z"/><path d="M9 9h6M9 12h4"/>'),
  move: s('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  brush: s('<path d="M20 3c-3 1-9 7-11 10l2 2c3-2 9-8 10-11zM9 13c-2 0-4 1.5-4 4 0 1.2-.8 2.3-2 3 4 1 8-.5 8-5z"/>'),
  smudge: s('<path d="M9 21v-7.5M9 13.5V5a1.5 1.5 0 0 1 3 0v6M12 10.5V4a1.5 1.5 0 0 1 3 0v7M15 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4.2a1.4 1.4 0 0 1 2.2-1.8L9 15"/>'),
  eraser: s('<path d="M8 20h12M16.5 3.5l4 4L10 18H6l-3-3 10.5-11.5z"/><path d="m9 9 6 6"/>'),
  layers: s('<path d="m12 3 9 5-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5"/>'),
  undo: s('<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: s('<path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>'),
  square: s('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  image: s('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  share: s('<path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  canvas: s('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>'),
  settings: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 3.6V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z"/>'),
  help: s('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>'),
  video: s('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>'),
  sym: s('<path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5"/>'),
  ref: s('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/>'),
  play: s('<path d="M7 5v14l11-7z" fill="currentColor"/>'),
  pause: s('<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/>'),
  trash: s('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  copy: s('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  brushImport: s('<path d="M12 3v11M8 10l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
};

export function icon(name) { return ICONS[name] || ''; }
