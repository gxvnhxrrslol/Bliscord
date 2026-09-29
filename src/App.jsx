import { useEffect } from 'react';
import { useStore } from './lib/store';
import { boot, logout } from './lib/actions';
import { native } from './lib/api';
import { TooltipLayer, Spinner } from './components/ui';
import TitleBar from './components/TitleBar';
import AuthScreen from './components/AuthScreen';
import Shell from './components/Shell';
import Icon from './components/Icons';

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(rgb, target, t) {
  return rgb.map((c, i) => Math.round(c + (target[i] - c) * t));
}

function useTheme() {
  const settings = useStore((s) => s.settings);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.scene = settings.glassScene;
    root.dataset.density = settings.density;
    root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full';
    const rgb = hexToRgb(settings.accent);
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--accent-rgb', rgb.join(','));
    root.style.setProperty('--accent-hover', `rgb(${mix(rgb, [255, 255, 255], 0.14).join(',')})`);
    root.style.setProperty('--accent-press', `rgb(${mix(rgb, [0, 0, 0], 0.12).join(',')})`);
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    root.style.setProperty('--on-accent', lum > 0.7 ? '#0b0e14' : '#ffffff');
    root.style.setProperty('--font-scale', String(settings.fontScale / 100));
  }, [settings]);
}

// Displacement maps for the liquid glass refraction: red shifts X near the
// left/right edges, green shifts Y near the top/bottom edges; the middle is
// neutral (128) so only the rim bends what is behind it.
const edgeMap = (axis) => {
  const [x2, y2, ch] = axis === 'x' ? [1, 0, (v) => `rgb(${v},0,0)`] : [0, 1, (v) => `rgb(0,${v},0)`];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256' preserveAspectRatio='none'><defs><linearGradient id='g' x1='0' y1='0' x2='${x2}' y2='${y2}'><stop offset='0' stop-color='${ch(255)}'/><stop offset='0.07' stop-color='${ch(128)}'/><stop offset='0.93' stop-color='${ch(128)}'/><stop offset='1' stop-color='${ch(0)}'/></linearGradient></defs><rect width='256' height='256' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};
const MAP_X = edgeMap('x');
const MAP_Y = edgeMap('y');

function GlassFilters() {
  return (
    <svg className="svg-defs" width="0" height="0" aria-hidden="true">
      {/* Bounding-box units so the edge map always matches the element's size. */}
      <filter id="liquid-glass" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
        <feImage href={MAP_X} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mx" />
        <feImage href={MAP_Y} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="my" />
        <feComposite in="mx" in2="my" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="map" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.012" result="blur" />
        <feDisplacementMap in="blur" in2="map" scale="0.08" xChannelSelector="R" yChannelSelector="G" result="bent" />
        <feColorMatrix in="bent" type="saturate" values="1.6" />
      </filter>
      <filter id="liquid-glass-strong" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
        <feImage href={MAP_X} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mx" />
        <feImage href={MAP_Y} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="my" />
        <feComposite in="mx" in2="my" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="map" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.004" result="blur" />
        <feDisplacementMap in="blur" in2="map" scale="0.12" xChannelSelector="R" yChannelSelector="G" result="bent" />
        <feColorMatrix in="bent" type="saturate" values="1.8" />
      </filter>
    </svg>
  );
}

function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="orb o1" />
      <div className="orb o2" />
      <div className="orb o3" />
      <div className="orb o4" />
      <div className="backdrop-grain" />
    </div>
  );
}

function Splash() {
  const connection = useStore((s) => s.connection);
  return (
    <div className="splash">
      <div className="splash-mark">
        <Icon.Logo size={44} />
      </div>
      <div className="splash-status">
        <Spinner size={16} />
        <span>{connection === 'offline' ? 'Waiting for server' : 'Connecting'}</span>
      </div>
      {connection === 'offline' && (
        <button className="link-btn splash-out" onClick={logout}>Log out</button>
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'error' ? <Icon.Info size={16} /> : t.kind === 'success' ? <Icon.Check size={16} /> : <Icon.Bell size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  useTheme();
  const status = useStore((s) => s.status);
  useEffect(() => { boot(); }, []);

  return (
    <div className={`app-root${native ? ' native' : ''}`}>
      <Backdrop />
      <GlassFilters />
      <TitleBar />
      <div className="app-body">
        {status === 'auth' && <AuthScreen />}
        {(status === 'boot' || status === 'connecting') && <Splash />}
        {status === 'ready' && <Shell />}
      </div>
      <TooltipLayer />
      <Toasts />
    </div>
  );
}
