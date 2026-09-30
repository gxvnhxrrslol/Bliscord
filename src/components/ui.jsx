import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetUrl, uploadFile } from '../lib/api';
import { colorFor, initials } from '../lib/format';
import { closeModal } from '../lib/actions';
import Icon from './Icons';
import { Decoration } from './Cosmetics';

/* ---------------- Status indicator ---------------- */

export function StatusDot({ status = 'offline', size = 10, className = '' }) {
  const id = useId().replace(/:/g, '');
  const r = 5;
  return (
    <svg className={`status-dot ${status} ${className}`} width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <defs>
        <mask id={`m${id}`}>
          <circle cx="5" cy="5" r={r} fill="#fff" />
          {status === 'idle' && <circle cx="2.4" cy="2.6" r="3.6" fill="#000" />}
          {status === 'dnd' && <rect x="2" y="4" width="6" height="2" rx="1" fill="#000" />}
          {status === 'offline' && <circle cx="5" cy="5" r="2.4" fill="#000" />}
        </mask>
      </defs>
      <circle cx="5" cy="5" r={r} mask={`url(#m${id})`} fill="currentColor" />
    </svg>
  );
}

/* ---------------- Avatar ---------------- */

export function Avatar({ user, size = 40, status, speaking = false, className = '', onClick, square = false, decorate = true }) {
  const decoration = decorate && size >= 20 ? user?.profile?.decoration : null;
  const src = assetUrl(user?.avatar);
  const dot = status ? Math.max(10, Math.round(size * 0.3)) : 0;
  const gap = size >= 64 ? 4 : 2.5;
  const inset = size >= 64 ? size * 0.04 : 0;
  const center = size - dot / 2 - inset;
  const mask = status
    ? `radial-gradient(circle at ${center}px ${center}px, transparent ${dot / 2 + gap}px, #000 ${dot / 2 + gap + 0.5}px)`
    : undefined;
  return (
    <div
      className={`avatar${speaking ? ' speaking' : ''}${square ? ' square' : ''} ${className}`}
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      <div className="avatar-img" style={{ WebkitMaskImage: mask, maskImage: mask, background: src ? undefined : user?.accentColor || colorFor(user?.id) }}>
        {src ? <img src={src} alt="" draggable={false} /> : <span style={{ fontSize: size * 0.38 }}>{initials(user?.displayName || user?.username)}</span>}
      </div>
      {decoration && <Decoration id={decoration} />}
      {status && (
        <span className="avatar-status" style={{ right: inset, bottom: inset }}>
          <StatusDot status={status} size={dot} />
        </span>
      )}
    </div>
  );
}

/* ---------------- Server icon ---------------- */

export function ServerGlyph({ server, size = 48 }) {
  const src = assetUrl(server?.icon);
  return (
    <div className="server-glyph" style={{ width: size, height: size, background: src ? undefined : colorFor(server?.id) }}>
      {src ? <img src={src} alt="" draggable={false} /> : <span style={{ fontSize: size * 0.34 }}>{initials(server?.name)}</span>}
    </div>
  );
}

/* ---------------- Tooltip manager ---------------- */

export function TooltipLayer() {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    let current = null;
    let timer = null;
    const show = (el) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      setTip({ text, rect: el.getBoundingClientRect(), side: el.getAttribute('data-tip-side') || 'top' });
    };
    const over = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      if (!el) { setTip(null); return; }
      timer = setTimeout(() => show(el), el.hasAttribute('data-tip-fast') ? 0 : 280);
    };
    const hide = () => { current = null; clearTimeout(timer); setTip(null); };
    document.addEventListener('mouseover', over);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const { rect, side } = tip;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x;
    let y;
    if (side === 'right') { x = rect.right + 12; y = rect.top + rect.height / 2 - h / 2; }
    else if (side === 'left') { x = rect.left - w - 12; y = rect.top + rect.height / 2 - h / 2; }
    else if (side === 'bottom') { x = rect.left + rect.width / 2 - w / 2; y = rect.bottom + 10; }
    else { x = rect.left + rect.width / 2 - w / 2; y = rect.top - h - 10; }
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    y = Math.max(8, Math.min(window.innerHeight - h - 8, y));
    el.style.transform = `translate(${x}px, ${y}px)`;
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={ref} className={`tooltip side-${tip.side}`} role="tooltip">
      {tip.text}
    </div>,
    document.body,
  );
}

/* ---------------- Buttons & inputs ---------------- */

export function IconButton({ icon: I, tip, side, active, danger, className = '', size = 20, ...rest }) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? ' active' : ''}${danger ? ' danger' : ''} ${className}`}
      data-tip={tip}
      data-tip-side={side}
      aria-label={tip}
      {...rest}
    >
      <I size={size} />
    </button>
  );
}

export function Button({ variant = 'primary', loading, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant}${loading ? ' loading' : ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Spinner size={16} /> : children}
    </button>
  );
}

export function Spinner({ size = 20 }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob">{checked ? <Icon.Check size={12} strokeWidth={3} /> : <Icon.X size={12} strokeWidth={3} />}</span>
    </button>
  );
}

export function Field({ label, error, children, hint }) {
  return (
    <label className="field">
      {label && (
        <span className={`field-label${error ? ' error' : ''}`}>
          {label}
          {error && <em> - {error}</em>}
        </span>
      )}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, format }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {format && <span className="slider-value">{format(value)}</span>}
    </div>
  );
}

export function Select({ value, options, onChange }) {
  return (
    <div className="select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <Icon.ChevronDown size={16} />
    </div>
  );
}

/* ---------------- Modal shell ---------------- */

export function isTopLayer(el) {
  const layers = document.querySelectorAll('.modal-backdrop, .settings-layer');
  return Boolean(el) && layers[layers.length - 1] === el;
}

export function Modal({ children, className = '', onClose = closeModal, size = 'md', bare = false }) {
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 140);
  };
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && isTopLayer(ref.current) && !document.querySelector('.menu') && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (
    <div ref={ref} className={`modal-backdrop${closing ? ' closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal modal-${size}${bare ? ' bare' : ''} ${className}`} role="dialog" aria-modal="true">
        {!bare && <IconButton icon={Icon.X} className="modal-close" onClick={close} tip="Close" side="left" />}
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>
  );
}

/* ---------------- Files ---------------- */

export function pickFiles({ accept = '*/*', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files || [])]);
    input.click();
  });
}

/** Downscale static images before upload. GIFs are kept as-is so they stay animated. */
export async function prepareImage(file, maxSize) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.9));
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

export async function uploadImage(file, maxSize = 1024) {
  const prepared = await prepareImage(file, maxSize);
  const res = await uploadFile(prepared);
  return res.url;
}

export async function imageSize(file) {
  if (!file.type.startsWith('image/')) return {};
  try {
    const bmp = await createImageBitmap(file);
    return { width: bmp.width, height: bmp.height };
  } catch {
    return {};
  }
}

/* ---------------- Misc ---------------- */

export function useOutsideClick(ref, onOutside, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside(e);
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [ref, onOutside, active]);
}

export function Empty({ icon: I = Icon.Sparkle, title, children }) {
  return (
    <div className="empty">
      <div className="empty-art"><I size={30} /></div>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  }
}
