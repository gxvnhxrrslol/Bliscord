import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, updateSettings, useStore } from '../lib/store';
import { closeModal, logout, openModal, toast, updateAccount, updateProfile } from '../lib/actions';
import { assetUrl, native } from '../lib/api';
import { voice, SCREEN_QUALITY, VIDEO_CODECS } from '../lib/voice';
import { colorFor, fullDate } from '../lib/format';
import { Avatar, Button, Field, Select, Slider, Switch, isTopLayer, pickFiles, uploadImage } from './ui';
import { Badges, VerifiedMark } from './Badges';
import { showChangelog } from '../lib/whatsnew';
import { DECORATIONS, EFFECTS, NAME_STYLES, ProfileEffect, StyledName, profileThemeStyle } from './Cosmetics';
import Icon from './Icons';

/* ---------------- Settings layer shell ---------------- */

export function SettingsLayer({ nav, tab, setTab, children, onClose = closeModal }) {
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);
  const close = () => { setClosing(true); setTimeout(onClose, 160); };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && isTopLayer(ref.current) && !document.querySelector('.menu')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div ref={ref} className={`settings-layer${closing ? ' closing' : ''}`}>
      <nav className="settings-nav">
        <div className="settings-nav-inner">
          {nav.map((item, i) => {
            if (item.heading) return <div key={i} className="settings-heading">{item.heading}</div>;
            if (item.separator) return <div key={i} className="settings-sep" />;
            return (
              <button
                key={item.id || i}
                className={`settings-tab${tab === item.id ? ' active' : ''}${item.danger ? ' danger' : ''}`}
                onClick={() => (item.onClick ? item.onClick() : setTab(item.id))}
              >
                {item.icon && <item.icon size={17} />}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <section className="settings-content">
        <div className="settings-content-inner" key={tab}>{children}</div>
        <button className="settings-close" onClick={close} aria-label="Close">
          <Icon.X size={20} />
          <span>ESC</span>
        </button>
      </section>
    </div>
  );
}

/* ---------------- My account ---------------- */

function AccountTab({ onEditProfile }) {
  const me = useStore((s) => s.me);
  const [form, setForm] = useState({ username: me.username, email: me.email, newPassword: '', currentPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = form.username !== me.username || form.email !== me.email || form.newPassword;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await updateAccount({
        username: form.username !== me.username ? form.username : undefined,
        email: form.email !== me.email ? form.email : undefined,
        newPassword: form.newPassword || undefined,
        currentPassword: form.currentPassword,
      });
      setForm((f) => ({ ...f, newPassword: '', currentPassword: '' }));
      toast('Account updated', 'success');
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const banner = assetUrl(me.banner);
  return (
    <>
      <h1>My Account</h1>
      <div className="account-card">
        <div className="account-banner" style={{ background: banner ? undefined : me.bannerColor || colorFor(me.id) }}>
          {banner && <img src={banner} alt="" />}
        </div>
        <div className="account-head">
          <Avatar user={me} size={80} status={me.presence} />
          <div className="account-head-text">
            <h2>{me.displayName}<VerifiedMark user={me} size={18} /></h2>
            <span className="muted">@{me.username}</span>
            <Badges user={me} />
          </div>
          <Button variant="soft" onClick={onEditProfile}>Edit profile</Button>
        </div>
        <div className="account-fields">
          <Field label="Username">
            <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '') })} maxLength={32} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="New password">
            <input className="input" type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" placeholder="Leave empty to keep" />
          </Field>
          {dirty && (
            <Field label="Current password" error={error}>
              <input className="input" type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
            </Field>
          )}
          {dirty && (
            <div className="row-end">
              <Button variant="ghost" onClick={() => setForm({ username: me.username, email: me.email, newPassword: '', currentPassword: '' })}>Reset</Button>
              <Button loading={busy} disabled={!form.currentPassword} onClick={save}>Save</Button>
            </div>
          )}
        </div>
      </div>
      <div className="settings-block">
        <h3>Session</h3>
        <div className="kv">
          <span>Member since</span><b>{fullDate(me.createdAt)}</b>
        </div>
        <Button variant="danger" onClick={logout}><Icon.Logout size={16} /> Log out</Button>
      </div>
    </>
  );
}

/* ---------------- Profile ---------------- */

const SWATCHES = ['#4f7cff', '#2bb3ff', '#1fc7a8', '#3fcf6e', '#ffc24f', '#ff8a4f', '#ff5c7a', '#e05cff', '#8a6cff', '#5f6b85'];

function ColorPick({ value, onChange, allowNone = true }) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none${!value ? ' active' : ''}`} onClick={() => onChange(null)} data-tip="Default">
          <Icon.Block size={14} />
        </button>
      )}
      {SWATCHES.map((c) => (
        <button key={c} className={`swatch${value === c ? ' active' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <label className={`swatch custom${value && !SWATCHES.includes(value) ? ' active' : ''}`} style={{ background: value && !SWATCHES.includes(value) ? value : undefined }} data-tip="Custom">
        <Icon.Palette size={14} />
        <input type="color" value={value || '#4f7cff'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function OptionTiles({ options, value, onChange, render }) {
  return (
    <div className="option-tiles">
      <button className={`option-tile none${!value ? ' active' : ''}`} onClick={() => onChange(undefined)}>
        <span className="option-art"><Icon.Block size={22} /></span>
        <span className="option-name">None</span>
      </button>
      {options.map((o) => (
        <button key={o.id} className={`option-tile${value === o.id ? ' active' : ''}`} onClick={() => onChange(o.id)}>
          <span className="option-art">{render(o.id)}</span>
          <span className="option-name">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function ProfileTab() {
  const me = useStore((s) => s.me);
  const initial = () => ({
    displayName: me.displayName, avatar: me.avatar, banner: me.banner, bannerColor: me.bannerColor, accentColor: me.accentColor,
    pronouns: me.pronouns, customStatus: me.customStatus, bio: me.bio, profile: { ...(me.profile || {}) },
  });
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v?.target ? v.target.value : v }));
  const setCosmetic = (k, v) => setDraft((d) => {
    const profile = { ...d.profile };
    if (v === undefined || v === null) delete profile[k];
    else profile[k] = v;
    return { ...d, profile };
  });

  const upload = async (key, max) => {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp' });
    if (!file) return;
    setUploading(key);
    try {
      set(key)(await uploadImage(file, max));
    } catch (err) {
      toast(err.message, 'error');
    }
    setUploading(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateProfile(draft);
      toast('Profile saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  const preview = { ...me, ...draft };
  const banner = assetUrl(preview.banner);
  const theme = draft.profile.themeColors;
  const demoUser = (patch) => ({ ...preview, profile: { ...draft.profile, ...patch } });

  return (
    <>
      <h1>Profile</h1>
      <div className="profile-editor">
        <div className="profile-form">
          <Field label="Display name">
            <input className="input" value={draft.displayName} maxLength={32} onChange={set('displayName')} />
          </Field>
          <Field label="Pronouns">
            <input className="input" value={draft.pronouns} maxLength={40} onChange={set('pronouns')} />
          </Field>
          <div className="settings-divider" />
          <Field label="Avatar">
            <div className="btn-row">
              <Button loading={uploading === 'avatar'} onClick={() => upload('avatar', 512)}>Change avatar</Button>
              {draft.avatar && <Button variant="ghost" onClick={() => set('avatar')(null)}>Remove</Button>}
            </div>
          </Field>
          <Field label="Banner">
            <div className="btn-row">
              <Button loading={uploading === 'banner'} onClick={() => upload('banner', 1600)}>Change banner</Button>
              {draft.banner && <Button variant="ghost" onClick={() => set('banner')(null)}>Remove</Button>}
            </div>
          </Field>
          <Field label="Banner color">
            <ColorPick value={draft.bannerColor} onChange={set('bannerColor')} />
          </Field>
          <Field label="Name color">
            <ColorPick value={draft.accentColor} onChange={set('accentColor')} />
          </Field>
          <div className="settings-divider" />
          <Field label="Custom status">
            <input className="input" value={draft.customStatus} maxLength={128} onChange={set('customStatus')} />
          </Field>
          <Field label="About me">
            <div className="textarea-wrap">
              <textarea className="input textarea" rows={5} value={draft.bio} maxLength={300} onChange={set('bio')} />
              <span className="count">{300 - (draft.bio || '').length}</span>
            </div>
          </Field>

          <div className="settings-divider" />
          <h2 className="subhead">Profile style</h2>
          <Field label="Profile theme">
            <div className="theme-colors">
              <Switch checked={Boolean(theme)} onChange={(v) => setCosmetic('themeColors', v ? [draft.accentColor || '#4f7cff', '#b56bff'] : null)} />
              {theme && (
                <>
                  <label className="theme-color" style={{ background: theme[0] }} data-tip="Primary">
                    <input type="color" value={theme[0]} onChange={(e) => setCosmetic('themeColors', [e.target.value, theme[1]])} />
                  </label>
                  <label className="theme-color" style={{ background: theme[1] }} data-tip="Accent">
                    <input type="color" value={theme[1]} onChange={(e) => setCosmetic('themeColors', [theme[0], e.target.value])} />
                  </label>
                </>
              )}
            </div>
          </Field>
          <Field label="Avatar decoration">
            <OptionTiles
              options={DECORATIONS}
              value={draft.profile.decoration}
              onChange={(v) => setCosmetic('decoration', v)}
              render={(id) => <Avatar user={demoUser({ decoration: id })} size={40} />}
            />
          </Field>
          <Field label="Profile effect">
            <OptionTiles
              options={EFFECTS}
              value={draft.profile.effect}
              onChange={(v) => setCosmetic('effect', v)}
              render={(id) => <span className="effect-swatch"><ProfileEffect id={id} /></span>}
            />
          </Field>
          <Field label="Name style">
            <OptionTiles
              options={NAME_STYLES}
              value={draft.profile.nameStyle}
              onChange={(v) => setCosmetic('nameStyle', v)}
              render={(id) => <StyledName user={demoUser({ nameStyle: id })} color={draft.accentColor}>Aa</StyledName>}
            />
          </Field>
        </div>
        <div className="profile-preview">
          <span className="field-label">Preview</span>
          <div
            className={`profile-card compact preview${theme ? ' themed' : ''}`}
            style={{ '--profile-accent': preview.accentColor || preview.bannerColor || colorFor(me.id), ...profileThemeStyle(preview) }}
          >
            <div className="profile-banner" style={{ background: banner ? undefined : preview.bannerColor || colorFor(me.id) }}>
              {banner && <img src={banner} alt="" />}
            </div>
            <ProfileEffect id={draft.profile.effect} />
            <div className="profile-avatar-wrap">
              <button className="avatar-edit" onClick={() => upload('avatar', 512)}>
                <Avatar user={preview} size={84} status={me.presence} className="profile-avatar" />
                <span className="avatar-edit-overlay"><Icon.Camera size={22} /></span>
              </button>
            </div>
            <Badges user={me} className="profile-badges" />
            <div className="profile-body">
              <div className="profile-names">
                <h3><StyledName user={preview} color={preview.accentColor}>{preview.displayName || me.username}</StyledName><VerifiedMark user={me} size={18} /></h3>
                <div className="profile-username">@{me.username}{preview.pronouns && <span className="profile-pronouns">{preview.pronouns}</span>}</div>
              </div>
              {preview.customStatus && <div className="profile-status">{preview.customStatus}</div>}
              <div className="profile-section">
                {preview.bio && (<><h4>About me</h4><p className="profile-bio">{preview.bio}</p></>)}
                <h4>Member since</h4>
                <div className="profile-since"><span><Icon.Logo size={14} /> {fullDate(me.createdAt)}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {dirty && (
        <div className="save-bar">
          <span>Unsaved changes</span>
          <Button variant="ghost" onClick={() => setDraft(initial())}>Reset</Button>
          <Button loading={busy} onClick={save}>Save changes</Button>
        </div>
      )}
    </>
  );
}

/* ---------------- Appearance ---------------- */

const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'glass', label: 'Liquid Glass' },
  { id: 'glass-light', label: 'Frost Glass' },
];

const SCENES = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'ocean', label: 'Deep Ocean' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'nebula', label: 'Nebula' },
  { id: 'mint', label: 'Mint' },
];

const ACCENTS = ['#4f7cff', '#2f8cff', '#23b5ff', '#6a5cff', '#9b5cff', '#1fc7a8', '#3fcf6e', '#ff8a4f', '#ff5c7a'];

function AppearanceTab() {
  const s = useStore((st) => st.settings);
  const [bgBusy, setBgBusy] = useState(false);
  const pickBackground = async () => {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp' });
    if (!file) return;
    setBgBusy(true);
    try {
      updateSettings({ customBackground: await uploadImage(file, 2560) });
    } catch (err) {
      toast(err.message, 'error');
    }
    setBgBusy(false);
  };
  return (
    <>
      <h1>Appearance</h1>
      <div className="settings-block">
        <h3>Theme</h3>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-card${s.theme === t.id ? ' active' : ''}`} onClick={() => updateSettings({ theme: t.id })}>
              <span className={`theme-preview tp-${t.id}`} data-scene={s.glassScene}>
                <span className="tp-dock" />
                <span className="tp-side" />
                <span className="tp-main"><i /><i /><i /></span>
              </span>
              <span className="theme-name">{t.label}{s.theme === t.id && <Icon.Check size={14} />}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-block">
        <h3>Background</h3>
        <div className="scene-row">
          {s.theme.startsWith('glass') && SCENES.map((sc) => (
            <button
              key={sc.id}
              className={`scene-chip sc-${sc.id}${!s.customBackground && s.glassScene === sc.id ? ' active' : ''}`}
              onClick={() => updateSettings({ glassScene: sc.id, customBackground: null })}
            >
              <span className="scene-swatch" />
              <span>{sc.label}</span>
            </button>
          ))}
          {!s.theme.startsWith('glass') && (
            <button className={`scene-chip${!s.customBackground ? ' active' : ''}`} onClick={() => updateSettings({ customBackground: null })}>
              <span className="scene-swatch plain" />
              <span>Theme default</span>
            </button>
          )}
          <button className={`scene-chip${s.customBackground ? ' active' : ''}`} onClick={pickBackground}>
            <span className="scene-swatch custom" style={{ backgroundImage: s.customBackground ? `url(${assetUrl(s.customBackground)})` : undefined }}>
              {!s.customBackground && (bgBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon.Upload size={14} />)}
            </span>
            <span>{s.customBackground ? 'Change image' : 'Custom image'}</span>
          </button>
        </div>
        {s.customBackground && (
          <Field label="Dim">
            <Slider value={s.backgroundDim ?? 35} min={0} max={85} onChange={(v) => updateSettings({ backgroundDim: v })} format={(v) => `${v}%`} />
          </Field>
        )}
      </div>
      <div className="settings-block">
        <h3>Accent</h3>
        <div className="swatches big">
          {ACCENTS.map((c) => (
            <button key={c} className={`swatch${s.accent === c ? ' active' : ''}`} style={{ background: c }} onClick={() => updateSettings({ accent: c })} />
          ))}
          <label className={`swatch custom${!ACCENTS.includes(s.accent) ? ' active' : ''}`} style={{ background: !ACCENTS.includes(s.accent) ? s.accent : undefined }} data-tip="Custom">
            <Icon.Palette size={16} />
            <input type="color" value={s.accent} onChange={(e) => updateSettings({ accent: e.target.value })} />
          </label>
        </div>
      </div>
      <div className="settings-block">
        <h3>Messages</h3>
        <div className="seg">
          {['cozy', 'compact'].map((d) => (
            <button key={d} className={s.density === d ? 'active' : ''} onClick={() => updateSettings({ density: d })}>
              {d === 'cozy' ? 'Cozy' : 'Compact'}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-block">
        <h3>Text size</h3>
        <Slider value={s.fontScale} min={85} max={125} step={5} onChange={(v) => updateSettings({ fontScale: v })} format={(v) => `${v}%`} />
      </div>
      <div className="settings-block">
        <div className="switch-row">
          <span>Reduce motion</span>
          <Switch checked={s.reduceMotion} onChange={(v) => updateSettings({ reduceMotion: v })} />
        </div>
      </div>
    </>
  );
}

/* ---------------- Voice & video ---------------- */

const toDb = (rms) => 20 * Math.log10(Math.max(rms, 1e-5));
const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 70) / 60) * 100));
const pctToRms = (pct) => 10 ** ((((pct / 100) * 60) - 70) / 20);

function MicMeter() {
  const sensitivity = useStore((s) => s.settings.inputSensitivity);
  const bar = useRef(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const off = voice.onLevel((level, threshold) => {
      if (!bar.current) return;
      bar.current.style.width = `${dbToPct(toDb(level))}%`;
      bar.current.classList.toggle('hot', level > threshold);
    });
    return () => { off(); voice.stopTest(); };
  }, []);

  const toggle = async () => {
    if (testing) { voice.stopTest(); setTesting(false); if (bar.current) bar.current.style.width = '0%'; }
    else { await voice.startTest(); setTesting(true); }
  };

  const pct = dbToPct(toDb(sensitivity));
  return (
    <div className="mic-test">
      <div className="meter">
        <div className="meter-fill" ref={bar} />
        <input
          className="meter-threshold"
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => updateSettings({ inputSensitivity: pctToRms(Number(e.target.value)) })}
          style={{ '--pct': `${pct}%` }}
          data-tip="Input sensitivity"
        />
      </div>
      <Button variant={testing ? 'soft' : 'primary'} onClick={toggle}>{testing ? 'Stop' : 'Mic test'}</Button>
    </div>
  );
}

function CameraPreview({ deviceId }) {
  const video = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return undefined;
    let stream;
    let alive = true;
    navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { ideal: deviceId } } : true })
      .then((st) => {
        if (!alive) { st.getTracks().forEach((t) => t.stop()); return; }
        stream = st;
        if (video.current) video.current.srcObject = st;
      })
      .catch(() => { toast('Could not open camera', 'error'); setOn(false); });
    return () => { alive = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, [on, deviceId]);
  return (
    <div className="camera-preview">
      <div className="camera-frame">
        {on ? <video ref={video} autoPlay muted playsInline /> : <Icon.Video size={34} />}
      </div>
      <Button variant={on ? 'soft' : 'primary'} onClick={() => setOn((v) => !v)}>{on ? 'Stop' : 'Test video'}</Button>
    </div>
  );
}

function VoiceTab() {
  const s = useStore((st) => st.settings);
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    const load = () => navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load);
  }, []);

  const opts = (kind) => {
    const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'communications');
    const out = list.map((d, i) => ({ value: d.deviceId, label: d.label || `${kind === 'videoinput' ? 'Camera' : 'Device'} ${i + 1}` }));
    if (kind !== 'videoinput' && !out.some((o) => o.value === 'default')) out.unshift({ value: 'default', label: 'Default' });
    return out;
  };

  const setInput = async (id) => { updateSettings({ inputDeviceId: id }); await voice.reloadMic(); };
  const setOutput = async (id) => { updateSettings({ outputDeviceId: id }); await voice.setOutputDevice(id); };
  const setCamera = async (id) => { updateSettings({ videoDeviceId: id }); if (voice.cameraStream) await voice.switchCamera(id).catch(() => {}); };
  const setProc = async (k, v) => { updateSettings({ [k]: v }); await voice.reloadMic(); };
  const stereo = s.micChannels === 'stereo';

  return (
    <>
      <h1>Voice & Video</h1>
      <div className="settings-grid-2">
        <Field label="Input device">
          <Select value={s.inputDeviceId} options={opts('audioinput')} onChange={setInput} />
        </Field>
        <Field label="Output device">
          <Select value={s.outputDeviceId} options={opts('audiooutput')} onChange={setOutput} />
        </Field>
        <Field label="Output volume">
          <Slider value={s.outputVolume} onChange={(v) => { updateSettings({ outputVolume: v }); voice.refreshVolumes(); }} format={(v) => `${v}%`} />
        </Field>
      </div>
      <div className="settings-block">
        <h3>Mic test and sensitivity</h3>
        <MicMeter />
      </div>
      <div className="settings-block">
        <h3>Microphone</h3>
        <div className="seg">
          {[['mono', 'Mono'], ['stereo', 'Stereo']].map(([k, label]) => (
            <button key={k} className={(s.micChannels || 'mono') === k ? 'active' : ''} onClick={() => setProc('micChannels', k)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="settings-block">
        <h3>Processing</h3>
        <div className="switch-row"><span>Noise suppression</span><Switch checked={!stereo && s.noiseSuppression} disabled={stereo} onChange={(v) => setProc('noiseSuppression', v)} /></div>
        <div className="switch-row"><span>Echo cancellation</span><Switch checked={!stereo && s.echoCancellation} disabled={stereo} onChange={(v) => setProc('echoCancellation', v)} /></div>
        <div className="switch-row"><span>Automatic gain control</span><Switch checked={!stereo && s.autoGainControl} disabled={stereo} onChange={(v) => setProc('autoGainControl', v)} /></div>
      </div>
      <div className="settings-block">
        <h3>Camera</h3>
        <Field label="Camera">
          <Select value={s.videoDeviceId || opts('videoinput')[0]?.value || ''} options={opts('videoinput').length ? opts('videoinput') : [{ value: '', label: 'No camera found' }]} onChange={setCamera} />
        </Field>
        <CameraPreview deviceId={s.videoDeviceId} />
      </div>
      <div className="settings-block">
        <h3>Screen share quality</h3>
        <div className="seg small">
          {Object.entries(SCREEN_QUALITY).map(([k, q]) => (
            <button key={k} className={s.screenQuality === k ? 'active' : ''} onClick={() => updateSettings({ screenQuality: k })}>
              {q.label}<small>{q.fps}fps</small>
            </button>
          ))}
        </div>
      </div>
      <div className="settings-block">
        <h3>Video codec</h3>
        <div className="seg small">
          {Object.entries(VIDEO_CODECS).map(([k, c]) => (
            <button key={k} className={(s.videoCodec || 'vp9') === k ? 'active' : ''} onClick={() => updateSettings({ videoCodec: k })}>{c.label}</button>
          ))}
        </div>
      </div>
      <div className="settings-block">
        <div className="switch-row"><span>Share audio with your screen</span><Switch checked={s.screenAudio} onChange={(v) => updateSettings({ screenAudio: v })} /></div>
      </div>
      <div className="settings-block">
        <Button variant="ghost" onClick={() => {
          const keep = { theme: s.theme, accent: s.accent, glassScene: s.glassScene, density: s.density, fontScale: s.fontScale };
          updateSettings({ ...DEFAULT_SETTINGS, ...keep });
          voice.reloadMic();
        }}>
          <Icon.Refresh size={15} /> Reset voice settings
        </Button>
      </div>
    </>
  );
}

/* ---------------- Notifications ---------------- */

function NotificationsTab() {
  const s = useStore((st) => st.settings);
  return (
    <>
      <h1>Notifications</h1>
      <div className="settings-block">
        <div className="switch-row">
          <span>Desktop notifications</span>
          <Switch
            checked={s.desktopNotifications}
            onChange={async (v) => {
              if (v && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
              updateSettings({ desktopNotifications: v });
            }}
          />
        </div>
        <div className="switch-row">
          <span>Sounds</span>
          <Switch checked={s.soundsEnabled} onChange={(v) => updateSettings({ soundsEnabled: v })} />
        </div>
      </div>
    </>
  );
}

/* ---------------- App & updates ---------------- */

function AppTab() {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.update);
  const statusText = {
    checking: 'Checking for updates',
    available: `Downloading ${update?.version || 'update'}`,
    downloading: `Downloading ${Math.round(update?.percent || 0)}%`,
    ready: `Version ${update?.version} is ready`,
    none: 'You are up to date',
    error: 'Update check failed',
  }[update?.status] || '';
  return (
    <>
      <h1>App</h1>
      <div className="settings-block">
        <div className="switch-row">
          <span>Keep running in the tray when closed</span>
          <Switch checked={s.closeToTray} onChange={(v) => { updateSettings({ closeToTray: v }); native?.setCloseToTray?.(v); }} />
        </div>
      </div>
      <div className="settings-block">
        <h3>Updates</h3>
        <div className="update-card">
          <div className="update-icon"><Icon.Download size={20} /></div>
          <div className="update-text">
            <b>Bliscord {native?.version}</b>
            <span>{statusText}</span>
          </div>
          {update?.status === 'ready' ? (
            <Button onClick={() => native.updates.install()}>Restart</Button>
          ) : (
            <Button variant="soft" loading={update?.status === 'checking'} onClick={() => native.updates.check()}>Check for updates</Button>
          )}
        </div>
      </div>
    </>
  );
}

function AboutTab() {
  return (
    <div className="about">
      <div className="about-logo"><Icon.Logo size={52} /></div>
      <h1>Bliscord</h1>
      <span className="muted">{native?.version ? `Version ${native.version}` : 'Web'}</span>
      <Button variant="soft" onClick={showChangelog}><Icon.Sparkle size={15} /> What&apos;s new</Button>
      <p className="about-credit">Made by Gxvn</p>
    </div>
  );
}

export default function SettingsModal({ tab: initialTab = 'account' }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const nav = [
    { heading: 'User' },
    { id: 'account', label: 'My Account', icon: Icon.User },
    { id: 'profile', label: 'Profile', icon: Icon.Edit },
    { heading: 'App' },
    { id: 'appearance', label: 'Appearance', icon: Icon.Palette },
    { id: 'voice', label: 'Voice & Video', icon: Icon.Mic },
    { id: 'notifications', label: 'Notifications', icon: Icon.Bell },
    ...(native ? [{ id: 'app', label: 'Updates', icon: Icon.Download }] : []),
    { id: 'about', label: 'About', icon: Icon.Info },
    { separator: true },
    { id: 'logout', label: 'Log out', icon: Icon.Logout, danger: true, onClick: () => openModal('confirm', { title: 'Log out', body: 'Are you sure you want to log out?', confirm: 'Log out', danger: true, onConfirm: logout }) },
  ];
  return (
    <SettingsLayer nav={nav} tab={tab} setTab={setTab}>
      {tab === 'account' && <AccountTab onEditProfile={() => setTab('profile')} />}
      {tab === 'profile' && <ProfileTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'voice' && <VoiceTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'app' && <AppTab />}
      {tab === 'about' && <AboutTab />}
    </SettingsLayer>
  );
}
