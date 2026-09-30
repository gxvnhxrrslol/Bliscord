import Icon from './Icons';

// Badges are granted on the server with `node server/admin.mjs badges ...`.
export const BADGES = {
  founder: { label: 'Bliscord Founder', icon: Icon.Crown, className: 'b-founder' },
  developer: { label: 'Bliscord Developer', icon: Icon.Code, className: 'b-developer' },
  verified: { label: 'Verified', icon: Icon.Check, className: 'b-verified' },
  staff: { label: 'Bliscord Staff', icon: Icon.Shield, className: 'b-staff' },
  early: { label: 'Early Supporter', icon: Icon.Sparkle, className: 'b-early' },
};

export function Badges({ user, className = '' }) {
  const list = (user?.badges || []).filter((b) => BADGES[b]);
  if (!list.length) return null;
  return (
    <div className={`badges ${className}`}>
      {list.map((id) => {
        const { label, icon: I, className: cls } = BADGES[id];
        return (
          <span key={id} className={`badge-chip ${cls}`} data-tip={label} data-tip-fast>
            <I size={14} strokeWidth={2.2} />
          </span>
        );
      })}
    </div>
  );
}

export const TAG_ICONS = {
  star: (p) => <Icon.Star filled {...p} />, fire: Icon.Fire, crown: Icon.Crown, shield: Icon.Shield, sparkle: Icon.Sparkle,
  moon: Icon.Moon, code: Icon.Code, bolt: Icon.Bolt, heart: Icon.Heart, music: Icon.Music, gamepad: Icon.Gamepad,
  leaf: Icon.Leaf, diamond: Icon.Diamond, skull: Icon.Skull,
};

/** A server tag chip: an icon or emoji plus up to five characters. */
export function TagChip({ tag, size = 'md', tip }) {
  if (!tag?.text) return null;
  const I = TAG_ICONS[tag.icon];
  return (
    <span className={`server-tag ${size}`} style={{ '--tag': tag.color || '#4f7cff' }} data-tip={tip === undefined ? tag.serverName : tip || undefined} data-tip-fast>
      {I ? <I size={size === 'lg' ? 14 : 11} strokeWidth={2.4} /> : <span className="server-tag-emoji">{tag.icon}</span>}
      {tag.text}
    </span>
  );
}

export const ServerTag = ({ user, size }) => <TagChip tag={user?.serverTag} size={size} />;

/** Small check seal shown next to verified users' names. */
export function VerifiedMark({ user, size = 16 }) {
  if (user?.badges?.includes('official')) {
    return (
      <span className="official-tag" data-tip="Official Bliscord account" data-tip-fast>
        <Icon.Check size={11} strokeWidth={3} />OFFICIAL
      </span>
    );
  }
  if (!user?.badges?.includes('verified')) return null;
  return (
    <span className="verified-mark" data-tip="Verified" data-tip-fast>
      <Icon.Seal size={size} />
    </span>
  );
}
