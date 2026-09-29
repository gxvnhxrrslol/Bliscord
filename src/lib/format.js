export function displayName(user, member) {
  if (!user) return 'Unknown';
  return member?.nickname || user.displayName || user.username;
}

const pad = (n) => String(n).padStart(2, '0');

export function timeOfDay(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function messageTimestamp(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (sameDay(d, today)) return `Today at ${timeOfDay(ts)}`;
  if (sameDay(d, yesterday)) return `Yesterday at ${timeOfDay(ts)}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${timeOfDay(ts)}`;
}

export function dayLabel(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

export function isSameDay(a, b) {
  return sameDay(new Date(a), new Date(b));
}

export function fullDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

let nonceSeq = 0;
export const nonce = () => `${Date.now().toString(36)}${(nonceSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Pick a stable color for a user without an accent set. */
export function colorFor(id = '') {
  const colors = ['#4f7cff', '#6a5cff', '#2bb3ff', '#1fc7a8', '#ff6b8a', '#ffa34f', '#b56bff', '#3fcf6e'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}
