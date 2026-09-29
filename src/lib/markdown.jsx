import { useState } from 'react';

const INLINE = new RegExp(
  [
    '(?<code>`([^`\\n]+)`)',
    '(?<spoiler>\\|\\|([\\s\\S]+?)\\|\\|)',
    '(?<bold>\\*\\*([\\s\\S]+?)\\*\\*)',
    '(?<underline>__([\\s\\S]+?)__)',
    '(?<italic>\\*([^*\\s](?:[^*]*?[^*\\s])?)\\*|(?<![\\w])_([^_\\s](?:[^_]*?[^_\\s])?)_(?![\\w]))',
    '(?<strike>~~([\\s\\S]+?)~~)',
    '(?<link>https?:\\/\\/[^\\s<]+[^\\s<.,:;"\')\\]!?])',
    '(?<mention>(?<![\\w])@([a-zA-Z0-9_.]{2,32}|everyone))',
  ].join('|'),
  'g',
);

function Spoiler({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`md-spoiler${open ? ' open' : ''}`} onClick={() => setOpen(true)}>
      {children}
    </span>
  );
}

function inline(text, ctx, keyBase = 'i') {
  const out = [];
  let last = 0;
  let i = 0;
  INLINE.lastIndex = 0;
  const matches = [...text.matchAll(INLINE)];
  for (const m of matches) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    const g = m.groups;
    if (g.code) out.push(<code key={key} className="md-code">{m[2]}</code>);
    else if (g.spoiler) out.push(<Spoiler key={key}>{inline(m[4], ctx, key)}</Spoiler>);
    else if (g.bold) out.push(<strong key={key}>{inline(m[6], ctx, key)}</strong>);
    else if (g.underline) out.push(<u key={key}>{inline(m[8], ctx, key)}</u>);
    else if (g.italic) out.push(<em key={key}>{inline(m[10] ?? m[11], ctx, key)}</em>);
    else if (g.strike) out.push(<s key={key}>{inline(m[13], ctx, key)}</s>);
    else if (g.link) {
      out.push(<a key={key} href={g.link} target="_blank" rel="noreferrer noopener" className="md-link">{g.link}</a>);
    } else if (g.mention) {
      const name = m[16];
      const user = ctx.resolveMention?.(name);
      if (user || name.toLowerCase() === 'everyone') {
        out.push(
          <span
            key={key}
            className={`md-mention${user?.id === ctx.meId || name.toLowerCase() === 'everyone' ? ' self' : ''}`}
            onClick={(e) => user && ctx.onMentionClick?.(user.id, e)}
          >
            @{user ? user.displayName : 'everyone'}
          </span>,
        );
      } else out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function blocks(text, ctx, keyBase) {
  const lines = text.split('\n');
  const out = [];
  let quote = [];
  let plain = [];
  const flushPlain = () => {
    if (!plain.length) return;
    const k = `${keyBase}-p${out.length}`;
    out.push(<span key={k}>{inline(plain.join('\n'), ctx, k)}</span>);
    plain = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const k = `${keyBase}-q${out.length}`;
    out.push(<blockquote key={k} className="md-quote">{inline(quote.join('\n'), ctx, k)}</blockquote>);
    quote = [];
  };
  for (const line of lines) {
    if (/^>\s/.test(line) || line === '>') {
      flushPlain();
      quote.push(line.replace(/^>\s?/, ''));
    } else {
      flushQuote();
      plain.push(line);
    }
  }
  flushPlain();
  flushQuote();
  return out;
}

export function renderMarkdown(text, ctx = {}) {
  if (!text) return null;
  const out = [];
  const fence = /```(?:([\w+#.-]+)?\n)?([\s\S]*?)```/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(fence)) {
    if (m.index > last) out.push(...blocks(text.slice(last, m.index).replace(/\n$/, ''), ctx, `b${n++}`));
    out.push(
      <pre key={`c${n++}`} className="md-pre">
        {m[1] && <span className="md-lang">{m[1]}</span>}
        <code>{m[2].replace(/\n$/, '')}</code>
      </pre>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...blocks(text.slice(last).replace(/^\n/, ''), ctx, `b${n++}`));
  return out;
}
