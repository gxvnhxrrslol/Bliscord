import { APP_VERSION } from '../lib/whatsnew';
import { Button, Modal } from './ui';
import Icon from './Icons';

function formatDate(d) {
  const date = new Date(`${d}T12:00:00`);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function WhatsNewModal({ entries = [], news = [] }) {
  return (
    <Modal size="md" className="whats-new">
      {(close) => (
        <>
          <div className="wn-hero">
            <span className="wn-orb a" />
            <span className="wn-orb b" />
            <div className="wn-mark"><Icon.Logo size={30} /></div>
            <h2>What&apos;s new</h2>
            <span className="wn-version">Version {APP_VERSION}</span>
          </div>
          <div className="wn-body">
            {news.map((n) => (
              <article key={n.id} className="wn-news">
                <div className="wn-news-head">
                  <span className="wn-tag"><Icon.Bell size={13} /> News</span>
                  {n.date && <span className="wn-date">{formatDate(n.date)}</span>}
                </div>
                <h3>{n.title}</h3>
                {n.body && <p>{n.body}</p>}
              </article>
            ))}
            {entries.map((e) => (
              <section key={e.version} className="wn-entry">
                <div className="wn-entry-head">
                  <span className="wn-chip">{e.version}</span>
                  <h3>{e.title}</h3>
                  {e.date && <span className="wn-date">{formatDate(e.date)}</span>}
                </div>
                <ul>
                  {e.items.map((item, i) => (
                    <li key={i} style={{ animationDelay: `${60 + i * 45}ms` }}>
                      <Icon.Sparkle size={14} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="wn-footer">
            <Button className="btn-lg" onClick={close}>Got it</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
