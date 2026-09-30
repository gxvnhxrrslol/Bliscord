import { useEffect, useRef, useState } from 'react';
import { login, register } from '../lib/actions';
import { Button, Field } from './ui';
import Icon from './Icons';

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ login: '', password: '', email: '', username: '', displayName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef(null);

  useEffect(() => { first.current?.focus(); }, [mode]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(form.login.trim(), form.password);
      else await register({ email: form.email.trim(), username: form.username.trim(), displayName: form.displayName.trim(), password: form.password });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card glass-strong">
        <section className="auth-hero">
          <div className="auth-hero-art">
            <span className="ring r1" />
            <span className="ring r2" />
            <span className="ring r3" />
          </div>
          <div className="auth-brand">
            <div className="auth-logo"><Icon.Logo size={34} /></div>
            <h1>Bliscord</h1>
          </div>
          <footer className="auth-credit">Made by Gxvn</footer>
        </section>

        <section className="auth-form-wrap">
          <form key={mode} className="auth-form" onSubmit={submit}>
            <h2>{mode === 'login' ? 'Welcome back' : 'Create an account'}</h2>
            {mode === 'login' ? (
              <>
                <Field label="Email or username">
                  <input ref={first} className="input" value={form.login} onChange={set('login')} autoComplete="username" required />
                </Field>
                <Field label="Password">
                  <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="current-password" required />
                </Field>
              </>
            ) : (
              <>
                <Field label="Email">
                  <input ref={first} className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
                </Field>
                <Field label="Display name">
                  <input className="input" value={form.displayName} onChange={set('displayName')} maxLength={32} />
                </Field>
                <Field label="Username">
                  <input
                    className="input"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '') }))}
                    maxLength={32}
                    autoComplete="username"
                    required
                  />
                </Field>
                <Field label="Password">
                  <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={8} required />
                </Field>
              </>
            )}
            {error && <div className="form-error">{error}</div>}
            <Button type="submit" loading={busy} className="btn-block btn-lg">
              {mode === 'login' ? 'Log in' : 'Continue'}
            </Button>
            <div className="auth-switch">
              {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
              <button type="button" className="link-btn" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
                {mode === 'login' ? 'Register' : 'Log in'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
