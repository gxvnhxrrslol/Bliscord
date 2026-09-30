// Profile cosmetics: avatar decorations, profile effects, profile themes and name styles.
// Everything is CSS/SVG so it stays light even with many avatars on screen.

export const DECORATIONS = [
  { id: 'glow', label: 'Halo' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'rainbow', label: 'Prism' },
  { id: 'neon', label: 'Neon' },
  { id: 'sparkle', label: 'Twinkle' },
  { id: 'flame', label: 'Ember' },
  { id: 'frost', label: 'Frost' },
  { id: 'crown', label: 'Crown' },
];

export const EFFECTS = [
  { id: 'stars', label: 'Starfield' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'snow', label: 'Snowfall' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'confetti', label: 'Confetti' },
];

export const NAME_STYLES = [
  { id: 'gradient', label: 'Gradient' },
  { id: 'glow', label: 'Glow' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'rainbow', label: 'Rainbow' },
];

/** The decoration ring drawn around an avatar. */
export function Decoration({ id }) {
  if (!id) return null;
  return (
    <span className={`deco deco-${id}`} aria-hidden="true">
      {id === 'orbit' && <><i /><i /></>}
      {id === 'sparkle' && <><i /><i /><i /><i /></>}
      {id === 'crown' && (
        <svg viewBox="0 0 24 24" className="deco-crown-icon"><path d="M4 17.5L3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z" /></svg>
      )}
    </span>
  );
}

function seeded(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Animated overlay across the top of a profile card. */
export function ProfileEffect({ id }) {
  if (!id) return null;
  const count = { stars: 26, snow: 30, bubbles: 16, confetti: 34, aurora: 0 }[id] ?? 0;
  return (
    <div className={`fx fx-${id}`} aria-hidden="true">
      {id === 'aurora' && <><span className="fx-band b1" /><span className="fx-band b2" /></>}
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${seeded(i, 1) * 100}%`,
            top: id === 'stars' ? `${seeded(i, 2) * 100}%` : undefined,
            animationDelay: `${-seeded(i, 3) * 8}s`,
            animationDuration: `${4 + seeded(i, 4) * 6}s`,
            '--s': 0.5 + seeded(i, 5),
            '--h': Math.round(seeded(i, 6) * 360),
          }}
        />
      ))}
    </div>
  );
}

/** A display name rendered with the user's name style. */
export function StyledName({ user, children, color, className = '' }) {
  const style = user?.profile?.nameStyle;
  if (!style) return <span className={className} style={{ color: color || undefined }}>{children}</span>;
  // Name colors are independent of the profile theme so the name never blends into the card.
  const a = color || user?.accentColor || '#7aa7ff';
  const b = '#f08cff';
  return (
    <span className={`name-style ns-${style} ${className}`} style={{ '--n1': a, '--n2': b }}>
      {children}
    </span>
  );
}

/** Inline style for a themed profile card (two-color profile theme). */
export function profileThemeStyle(user) {
  const colors = user?.profile?.themeColors;
  if (!colors) return {};
  return { '--pt1': colors[0], '--pt2': colors[1] };
}
