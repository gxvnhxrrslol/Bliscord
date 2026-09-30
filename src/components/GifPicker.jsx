import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { gifApi, toggleFavoriteGif } from '../lib/actions';
import { assetUrl } from '../lib/api';
import Icon from './Icons';

const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Star toggle shown in the top-left corner of a GIF. */
export function GifStar({ gif, className = '' }) {
  const saved = useStore((s) => s.favoriteGifs.some((g) => g.url === gif.url));
  return (
    <button
      className={`gif-star${saved ? ' on' : ''} ${className}`}
      data-tip={saved ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => { e.stopPropagation(); toggleFavoriteGif(gif).catch(() => {}); }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Icon.Star size={16} filled={saved} strokeWidth={2} />
    </button>
  );
}

function GifGrid({ items, onPick, onMore, loading, done }) {
  const sentinel = useRef(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !onMore || done) return undefined;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && onMore(), { rootMargin: '240px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore, done, items.length]);

  // Two balanced columns, filled shortest-first like a masonry wall.
  const cols = [[], []];
  const heights = [0, 0];
  for (const g of items) {
    const i = heights[0] <= heights[1] ? 0 : 1;
    cols[i].push(g);
    heights[i] += g.width && g.height ? g.height / g.width : 0.75;
  }
  return (
    <div className="gif-grid">
      {cols.map((col, i) => (
        <div className="gif-col" key={i}>
          {col.map((g) => (
            <div
              key={g.url}
              className="gif-cell"
              role="button"
              tabIndex={0}
              style={{ aspectRatio: g.width && g.height ? `${g.width} / ${g.height}` : '4 / 3' }}
              onClick={() => onPick(g)}
              onKeyDown={(e) => e.key === 'Enter' && onPick(g)}
            >
              <img src={assetUrl(g.preview || g.url)} alt={g.title || ''} loading="lazy" draggable={false} />
              <GifStar gif={g} />
            </div>
          ))}
        </div>
      ))}
      <div ref={sentinel} className="gif-sentinel">{loading && <span className="spinner" />}</div>
    </div>
  );
}

export default function GifPicker({ onPick, onClose }) {
  const favorites = useStore((s) => s.favoriteGifs);
  const [query, setQuery] = useState('');
  const [view, setView] = useState(null); // null = home, { kind: 'favorites' | 'trending' | 'search', term }
  const [home, setHome] = useState(null);
  const [results, setResults] = useState({ items: [], page: 0, hasNext: true, loading: false });
  const [error, setError] = useState('');
  const box = useRef(null);
  const input = useRef(null);
  const token = useRef(0);

  useEffect(() => {
    input.current?.focus();
    gifApi.categories().then(setHome).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const down = (e) => { if (box.current && !box.current.contains(e.target) && !e.target.closest?.('.composer-gif')) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true); };
  }, [onClose]);

  const load = useCallback(async (v, page) => {
    const my = ++token.current;
    setResults((r) => ({ ...(page === 1 ? { items: [], hasNext: true } : r), page, loading: true }));
    try {
      const res = v.kind === 'trending' ? await gifApi.trending(page) : await gifApi.search(v.term, page);
      if (my !== token.current) return;
      setError('');
      setResults((r) => {
        const seen = new Set(page === 1 ? [] : r.items.map((g) => g.url));
        const items = [...(page === 1 ? [] : r.items), ...res.items.filter((g) => !seen.has(g.url))];
        return { items, page, hasNext: res.hasNext && res.items.length > 0, loading: false };
      });
    } catch (e) {
      if (my !== token.current) return;
      setError(e.message);
      setResults((r) => ({ ...r, loading: false, hasNext: false }));
    }
  }, []);

  const open = (v) => {
    setView(v);
    if (v.kind !== 'favorites') load(v, 1);
  };

  // Search as you type, after a short pause.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      if (view?.kind === 'search') setView(null);
      return undefined;
    }
    const t = setTimeout(() => open({ kind: 'search', term }), 320);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const more = useCallback(() => {
    if (!view || view.kind === 'favorites' || results.loading || !results.hasNext) return;
    load(view, results.page + 1);
  }, [view, results, load]);

  const back = () => { setView(null); setQuery(''); input.current?.focus(); };
  const pick = (g) => { onPick(g); onClose(); };

  let body;
  if (!view) {
    const tiles = [
      { key: 'fav', label: 'Favorites', icon: <Icon.Star size={18} filled />, preview: favorites[0]?.preview || favorites[0]?.url, go: () => open({ kind: 'favorites' }) },
      { key: 'trend', label: 'Trending', icon: <Icon.Fire size={18} />, preview: home?.trending, go: () => open({ kind: 'trending' }) },
      ...(home?.categories || []).map((c) => ({ key: c.name, label: title(c.name), preview: c.preview, go: () => { setQuery(c.name); } })),
    ];
    body = (
      <>
        <div className="gif-tiles">
          {tiles.map((t) => (
            <button key={t.key} className={`gif-tile${t.key === 'fav' ? ' fav' : ''}`} onClick={t.go}>
              {t.preview && <img src={assetUrl(t.preview)} alt="" loading="lazy" draggable={false} />}
              <span className="gif-tile-label">{t.icon}{t.label}</span>
            </button>
          ))}
          {!home && !error && Array.from({ length: 8 }, (_, i) => <div key={i} className="gif-tile skeleton" />)}
        </div>
        {error && <div className="gif-empty">{error}</div>}
      </>
    );
  } else if (view.kind === 'favorites') {
    body = favorites.length
      ? <GifGrid items={favorites} onPick={pick} done />
      : <div className="gif-empty"><Icon.Star size={30} /><span>No favorites yet</span></div>;
  } else {
    body = (
      <>
        <GifGrid items={results.items} onPick={pick} onMore={more} loading={results.loading} done={!results.hasNext} />
        {!results.loading && !results.items.length && <div className="gif-empty">{error || 'No GIFs found'}</div>}
      </>
    );
  }

  const heading = view?.kind === 'favorites' ? 'Favorites' : view?.kind === 'trending' ? 'Trending' : null;

  return (
    <div className="gif-picker" ref={box} onMouseDown={(e) => e.stopPropagation()}>
      <div className="gif-head">
        {view && (
          <button className="gif-back" onClick={back} aria-label="Back"><Icon.ChevronLeft size={18} /></button>
        )}
        {heading ? (
          <span className="gif-heading">{heading}</span>
        ) : (
          <label className="gif-search">
            <Icon.Search size={16} />
            <input
              ref={input}
              value={query}
              placeholder="Search KLIPY"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) open({ kind: 'search', term: query.trim() }); }}
            />
            {query && <button className="gif-clear" onClick={back} aria-label="Clear"><Icon.X size={14} /></button>}
          </label>
        )}
      </div>
      <div className="gif-body">{body}</div>
    </div>
  );
}
