import { useId } from 'react';

function gearPath(teeth = 8, outer = 9.6, inner = 7.3, cx = 12, cy = 12) {
  const step = (Math.PI * 2) / teeth;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    pts.push([a - step * 0.3, inner], [a - step * 0.17, outer], [a + step * 0.17, outer], [a + step * 0.3, inner]);
  }
  return `M${pts.map(([ang, r]) => `${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`).join('L')}Z`;
}
const GEAR = gearPath();

// Scalloped seal used for the verified mark.
function sealPath(bumps = 12, outer = 10.6, inner = 9.1) {
  const pts = [];
  for (let i = 0; i < bumps * 2; i++) {
    const a = (i / (bumps * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const SEAL = sealPath();

const Svg = ({ size = 20, children, className = '', fill = 'none', strokeWidth = 1.8, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`icon ${className}`}
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

const Slash = () => <path d="M4 4l16 16" />;

const BUBBLE = 'M332 214h360c95 0 150 55 150 150v250c0 95-55 150-150 150H420l-128 104c-22 18-46 6-42-22l14-86c-72-12-114-64-114-146V364c0-95 55-150 150-150z';
const B_MARK = 'M414 330v318M414 330h118a76 76 0 0 1 0 152H414M414 482h132a83 83 0 0 1 0 166H414';

function Logo({ size = 20, className = '' }) {
  const id = `lg${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="136 181 720 720" className={`icon ${className}`} aria-hidden="true">
      <mask id={id}>
        <rect x="0" y="0" width="1024" height="1024" fill="#fff" />
        <path d={B_MARK} fill="none" stroke="#000" strokeWidth="72" strokeLinecap="round" strokeLinejoin="round" />
      </mask>
      <path d={BUBBLE} fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}

export const Icon = {
  Logo,
  Plus: (p) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  X: (p) => <Svg {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Svg>,
  Check: (p) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>,
  Hash: (p) => <Svg {...p}><path d="M9.5 4L7.5 20M16.5 4l-2 16M5 9h15M4 15h15" /></Svg>,
  Speaker: (p) => (
    <Svg {...p}>
      <path d="M4 9.5h3L11.5 6v12L7 14.5H4z" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.8 7a7 7 0 0 1 0 10" />
    </Svg>
  ),
  Mic: (p) => (
    <Svg {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </Svg>
  ),
  MicOff: (p) => (
    <Svg {...p}>
      <path d="M15 10.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.4 6.4 0 0 1-.6 2.7M12 17.5V21M9 21h6" />
      <Slash />
    </Svg>
  ),
  Headphones: (p) => (
    <Svg {...p}>
      <path d="M4 15.5V12a8 8 0 0 1 16 0v3.5" />
      <path d="M4 15a2 2 0 0 1 2-2h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2z" />
    </Svg>
  ),
  HeadphonesOff: (p) => (
    <Svg {...p}>
      <path d="M4 15.5V12a8 8 0 0 1 12.3-6.7M19.4 9a8 8 0 0 1 .6 3v3.5" />
      <path d="M4 15a2 2 0 0 1 2-2h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2zM20 15v3a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-3" />
      <Slash />
    </Svg>
  ),
  Settings: (p) => (
    <Svg {...p}>
      <path d={GEAR} />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  Phone: (p) => (
    <Svg {...p}>
      <path d="M5.2 4h3.2l1.8 4.4-2.2 1.4a11 11 0 0 0 6.2 6.2l1.4-2.2 4.4 1.8v3.2a1.6 1.6 0 0 1-1.7 1.6C10.5 20 4 13.5 3.6 5.7A1.6 1.6 0 0 1 5.2 4z" />
    </Svg>
  ),
  PhoneOff: (p) => (
    <Svg {...p}>
      <path
        transform="rotate(135 12 12)"
        d="M5.2 4h3.2l1.8 4.4-2.2 1.4a11 11 0 0 0 6.2 6.2l1.4-2.2 4.4 1.8v3.2a1.6 1.6 0 0 1-1.7 1.6C10.5 20 4 13.5 3.6 5.7A1.6 1.6 0 0 1 5.2 4z"
      />
    </Svg>
  ),
  Video: (p) => (
    <Svg {...p}>
      <rect x="3" y="6" width="12.5" height="12" rx="2.5" />
      <path d="M15.5 10.5l5-3v9l-5-3" />
    </Svg>
  ),
  VideoOff: (p) => (
    <Svg {...p}>
      <path d="M9 6h4a2.5 2.5 0 0 1 2.5 2.5v4M15.5 16a2.5 2.5 0 0 1-2.5 2H5.5A2.5 2.5 0 0 1 3 15.5v-7A2.5 2.5 0 0 1 5 6.1M15.5 10.5l5-3v9l-3.2-1.9" />
      <Slash />
    </Svg>
  ),
  Screen: (p) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M8.5 20.5h7M12 16.5v4M12 13V7.8M9.5 10.2L12 7.7l2.5 2.5" />
    </Svg>
  ),
  ScreenOff: (p) => (
    <Svg {...p}>
      <path d="M7 4h12a2 2 0 0 1 2 2v8.5a2 2 0 0 1-1 1.7M16.5 16.5H5a2 2 0 0 1-2-2V6a2 2 0 0 1 1-1.7M8.5 20.5h7M12 16.5v4" />
      <Slash />
    </Svg>
  ),
  Users: (p) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.2 14.2a6.5 6.5 0 0 1 3.3 5.3" />
    </Svg>
  ),
  User: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </Svg>
  ),
  UserPlus: (p) => (
    <Svg {...p}>
      <circle cx="9.5" cy="8" r="4" />
      <path d="M2.5 20.5a7 7 0 0 1 14 0M19 8v6M16 11h6" />
    </Svg>
  ),
  UserX: (p) => (
    <Svg {...p}>
      <circle cx="9.5" cy="8" r="4" />
      <path d="M2.5 20.5a7 7 0 0 1 14 0M17 8.5l4 4M21 8.5l-4 4" />
    </Svg>
  ),
  Message: (p) => (
    <Svg {...p}>
      <path d="M6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5v-8A2.5 2.5 0 0 1 6.5 4z" />
    </Svg>
  ),
  Edit: (p) => (
    <Svg {...p}>
      <path d="M4 20v-3.8L15.2 5a2.1 2.1 0 0 1 3 0l.8.8a2.1 2.1 0 0 1 0 3L7.8 20zM13.5 6.8l3.7 3.7" />
    </Svg>
  ),
  Trash: (p) => (
    <Svg {...p}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6" />
    </Svg>
  ),
  Reply: (p) => (
    <Svg {...p}>
      <path d="M9.5 5L4 10.5 9.5 16M4 10.5h10a6 6 0 0 1 6 6V19" />
    </Svg>
  ),
  PlusCircle: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </Svg>
  ),
  Send: (p) => (
    <Svg {...p}>
      <path d="M20.5 3.5L3.5 10.8l6.9 2.8 2.8 6.9z" />
      <path d="M10.4 13.6l10.1-10.1" />
    </Svg>
  ),
  Image: (p) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.8" />
      <path d="M21 16l-5-5-8.5 9" />
    </Svg>
  ),
  File: (p) => (
    <Svg {...p}>
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5" />
    </Svg>
  ),
  Download: (p) => <Svg {...p}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></Svg>,
  Upload: (p) => <Svg {...p}><path d="M12 20V9M7 13.5l5-5 5 5M5 4h14" /></Svg>,
  ChevronDown: (p) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>,
  ChevronRight: (p) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>,
  ChevronLeft: (p) => <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>,
  Logout: (p) => <Svg {...p}><path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9" /></Svg>,
  Crown: (p) => (
    <Svg {...p} fill="currentColor" strokeWidth={1.2}>
      <path d="M4 17.5L3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z" />
      <path d="M4.5 20h15" fill="none" strokeWidth={1.8} />
    </Svg>
  ),
  Shield: (p) => <Svg {...p}><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.3-7.5 9.5-4.3-1.2-7.5-5-7.5-9.5V6z" /></Svg>,
  Link: (p) => (
    <Svg {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Svg>
  ),
  Copy: (p) => (
    <Svg {...p}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </Svg>
  ),
  At: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8" />
    </Svg>
  ),
  Bell: (p) => (
    <Svg {...p}>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
    </Svg>
  ),
  Palette: (p) => (
    <Svg {...p}>
      <path d="M12 3a9 9 0 0 0 0 18c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
      <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.8" cy="7.3" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.6" cy="7.3" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  ),
  Lock: (p) => (
    <Svg {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
  Search: (p) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Svg>
  ),
  More: (p) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </Svg>
  ),
  MoreV: (p) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </Svg>
  ),
  WinMin: (p) => <Svg {...p} strokeWidth={1.4}><path d="M6 12h12" /></Svg>,
  WinMax: (p) => <Svg {...p} strokeWidth={1.4}><rect x="6" y="6" width="12" height="12" rx="1.5" /></Svg>,
  WinRestore: (p) => (
    <Svg {...p} strokeWidth={1.4}>
      <rect x="6" y="8.5" width="9.5" height="9.5" rx="1.5" />
      <path d="M9 8.5V7.5A1.5 1.5 0 0 1 10.5 6h6A1.5 1.5 0 0 1 18 7.5v6a1.5 1.5 0 0 1-1.5 1.5h-1" />
    </Svg>
  ),
  WinClose: (p) => <Svg {...p} strokeWidth={1.4}><path d="M7 7l10 10M17 7L7 17" /></Svg>,
  ArrowDown: (p) => <Svg {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Svg>,
  Refresh: (p) => <Svg {...p}><path d="M20 11.5a8 8 0 1 0-2.3 5.7M20 5v6.5h-6.5" /></Svg>,
  Block: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </Svg>
  ),
  Fullscreen: (p) => <Svg {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>,
  ExitFullscreen: (p) => <Svg {...p}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Svg>,
  Moon: (p) => <Svg {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></Svg>,
  Signal: (p) => <Svg {...p}><path d="M5 19v-3M10 19v-6.5M15 19V9M20 19V5" /></Svg>,
  SpeakerOff: (p) => (
    <Svg {...p}>
      <path d="M4 9.5h3L11.5 6v12L7 14.5H4zM15.5 10l5 5M20.5 10l-5 5" />
    </Svg>
  ),
  EyeOff: (p) => (
    <Svg {...p}>
      <path d="M10 5.8A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.3 7.1C3.9 8.8 2.5 12 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M4 4l16 16" />
    </Svg>
  ),
  Eye: (p) => (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  Camera: (p) => (
    <Svg {...p}>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="12.8" r="3.5" />
    </Svg>
  ),
  Compass: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </Svg>
  ),
  Globe: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </Svg>
  ),
  Info: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.1" />
    </Svg>
  ),
  Grip: (p) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
    </Svg>
  ),
  Grid: (p) => (
    <Svg {...p}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  ),
  Megaphone: (p) => (
    <Svg {...p}>
      <path d="M4 10v4a1 1 0 0 0 1 1h2.5l6.5 4V5L7.5 9H5a1 1 0 0 0-1 1zM17 9a3.5 3.5 0 0 1 0 6M7.5 15l1 4.5" />
    </Svg>
  ),
  Book: (p) => (
    <Svg {...p}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7.5h6M9 11h4" />
    </Svg>
  ),
  HashLock: (p) => (
    <Svg {...p}>
      <path d="M9.5 4L7.5 20M16.2 4l-.8 6.5M5 9h15M4 15h8" />
      <rect x="14.5" y="15.5" width="7" height="5.5" rx="1.2" />
      <path d="M16 15.5v-1.3a2 2 0 0 1 4 0v1.3" />
    </Svg>
  ),
  SpeakerLock: (p) => (
    <Svg {...p}>
      <path d="M3 9.5h3L10.5 6v12L6 14.5H3zM13.5 9.5a3.5 3.5 0 0 1 .6 4" />
      <rect x="14.5" y="15.5" width="7" height="5.5" rx="1.2" />
      <path d="M16 15.5v-1.3a2 2 0 0 1 4 0v1.3" />
    </Svg>
  ),
  Tag: (p) => (
    <Svg {...p}>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.8 7.8a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0l-7.8-7.8a1 1 0 0 1-.3-.7z" />
      <circle cx="8" cy="8" r="1.5" />
    </Svg>
  ),
  FolderPlus: (p) => (
    <Svg {...p}>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2.5H18a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5zM12 11v5M9.5 13.5h5" />
    </Svg>
  ),
  Clock: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  Code: (p) => <Svg {...p}><path d="M8 7.5L3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.6 5.5l-3.2 13" /></Svg>,
  Seal: ({ size = 16, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`icon ${className}`} aria-hidden="true">
      <path d={SEAL} fill="currentColor" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M7.8 12.3l2.8 2.8 5.6-5.8" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Sparkle: (p) => <Svg {...p}><path d="M12 3.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" /></Svg>,
  Folder: (p) => <Svg {...p}><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.5l2 2.5H18a2.5 2.5 0 0 1 2.5 2.5v7.5A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5z" /></Svg>,
  Gif: (p) => (
    <Svg {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="3.5" />
      <path d="M10 10.1c-.3-.6-.9-.9-1.6-.9-1.1 0-1.8.9-1.8 2.8s.7 2.8 1.8 2.8c.9 0 1.6-.6 1.6-1.6V12.6H8.6" strokeWidth="1.6" />
      <path d="M12.6 9.3v5.4M15.3 14.7V9.3h2.8M15.3 12h2.3" strokeWidth="1.6" />
    </Svg>
  ),
  Star: ({ filled, ...p }) => (
    <Svg {...p} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.96 5.6L12 16.6l-5.01 2.65.96-5.6L3.9 9.7l5.6-.8z" />
    </Svg>
  ),
  Fire: (p) => <Svg {...p}><path d="M12 21c-3.6 0-6-2.5-6-5.8 0-3.3 2.6-5 3.4-8.2 1.9 1.4 2.3 3.2 2.3 4.4.9-.6 1.5-1.8 1.5-3 2.4 1.7 4.8 4.4 4.8 7.3 0 2.8-2.4 5.3-6 5.3z" /></Svg>,
  Follow: (p) => (
    <Svg {...p}>
      <path d="M4 11.5v1.8a1.2 1.2 0 0 0 1.2 1.2H7l6 4V6.5l-6 4H5.2A1.2 1.2 0 0 0 4 11.5z" />
      <path d="M18 9v6M15 12h6" />
    </Svg>
  ),
};

export default Icon;
