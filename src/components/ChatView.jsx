import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getState, setState, useStore, withKey, withoutKey } from '../lib/store';
import {
  deleteMessage, discardMessage, editMessage, loadMessages, loadOlder, markRead, openMenu, openModal, openPopout,
  retryMessage, sendMessage, sendTyping, stopTyping, startCall, toast, addFriendById, removeFriend, blockUser, unblockUser,
  acceptFriend,
} from '../lib/actions';
import { assetUrl, uploadFile } from '../lib/api';
import { dayLabel, displayName, fileSize, isSameDay, messageTimestamp, nonce, timeOfDay } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useVoice } from '../lib/voice';
import { Avatar, Button, IconButton, copyText, imageSize, pickFiles, prepareImage } from './ui';
import { CallStage } from './VoiceStage';
import { VerifiedMark } from './Badges';
import Icon from './Icons';

const GROUP_WINDOW = 7 * 60 * 1000;
const drafts = {};

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function ChatHeader({ icon, title, topic, children, onTitleClick }) {
  return (
    <header className="chat-header">
      <div className="chat-header-title" onClick={onTitleClick}>
        {icon}
        <h2>{title}</h2>
      </div>
      {topic && <div className="chat-header-topic" data-tip={topic.length > 80 ? topic : undefined} data-tip-side="bottom">{topic}</div>}
      <div className="chat-header-actions">{children}</div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

function Attachment({ a }) {
  const url = assetUrl(a.url);
  if (a.type?.startsWith('image/')) {
    const w = a.width || 400;
    const h = a.height || 300;
    const scale = Math.min(1, 420 / w, 320 / h);
    return (
      <button
        className="att-image"
        style={{ width: Math.round(w * scale), aspectRatio: `${w} / ${h}` }}
        onClick={() => openModal('image', { src: url, name: a.name })}
      >
        <img src={url} alt={a.name} loading="lazy" draggable={false} />
      </button>
    );
  }
  if (a.type?.startsWith('video/')) {
    return <video className="att-video" src={url} controls preload="metadata" />;
  }
  if (a.type?.startsWith('audio/')) {
    return (
      <div className="att-file">
        <Icon.Speaker size={26} />
        <div className="att-file-meta">
          <span className="att-file-name">{a.name}</span>
          <audio src={url} controls preload="metadata" />
        </div>
      </div>
    );
  }
  return (
    <div className="att-file">
      <Icon.File size={30} />
      <div className="att-file-meta">
        <a className="att-file-name" href={url} download={a.name} target="_blank" rel="noreferrer">{a.name}</a>
        <span className="att-file-size">{fileSize(a.size)}</span>
      </div>
      <a className="att-download" href={url} download={a.name} target="_blank" rel="noreferrer" data-tip="Download">
        <Icon.Download size={18} />
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Message                                                             */
/* ------------------------------------------------------------------ */

const JOIN_LINES = [
  (n) => <><b>{n}</b> just landed.</>,
  (n) => <>Welcome, <b>{n}</b>.</>,
  (n) => <><b>{n}</b> joined the server.</>,
  (n) => <><b>{n}</b> is here.</>,
  (n) => <>Everyone say hi to <b>{n}</b>.</>,
];

function EditBox({ message, onDone }) {
  const [value, setValue] = useState(message.content);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
  }, [value]);
  const save = async () => {
    if (value.trim() === message.content.trim()) return onDone();
    if (!value.trim() && !message.attachments.length) {
      onDone();
      openModal('confirm', { title: 'Delete message', body: 'Delete this message?', confirm: 'Delete', danger: true, onConfirm: () => deleteMessage(message.id) });
      return undefined;
    }
    await editMessage(message.id, value).catch(() => {});
    return onDone();
  };
  return (
    <div className="edit-box">
      <textarea
        ref={ref}
        className="composer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onDone(); }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
        }}
        rows={1}
      />
      <div className="edit-hint">
        <button className="link-btn" onClick={onDone}>Cancel</button>
        <button className="link-btn" onClick={save}>Save</button>
      </div>
    </div>
  );
}

const MessageItem = memo(function MessageItem({ message: m, grouped, author, member, meId, isOwnerAuthor, canModerate, editing, isNew, serverId, mentionCtx }) {
  const mine = m.authorId === meId;
  const name = displayName(author, member);
  const popout = (e) => openPopout(m.authorId, e.currentTarget.getBoundingClientRect(), serverId);

  if (m.kind === 'join' || m.kind === 'call') {
    const line = m.kind === 'join'
      ? JOIN_LINES[parseInt(m.id.slice(-4), 16) % JOIN_LINES.length](name)
      : <><b>{name}</b> started a call.</>;
    return (
      <div className={`msg msg-system${isNew ? ' enter' : ''}`} data-id={m.id}>
        <div className="msg-gutter">
          <span className={`system-icon ${m.kind}`}>{m.kind === 'join' ? <Icon.ArrowDown size={16} style={{ transform: 'rotate(-90deg)' }} /> : <Icon.Phone size={15} />}</span>
        </div>
        <div className="msg-body">
          <span className="system-text">{line}</span>
          <span className="msg-time" data-tip={new Date(m.createdAt).toLocaleString()}>{messageTimestamp(m.createdAt)}</span>
        </div>
      </div>
    );
  }

  const mentioned = !mine && mentionCtx.meUsername && new RegExp(`(^|\\W)@(${mentionCtx.meUsername}|everyone)(?![\\w.])`, 'i').test(m.content);
  const reply = () => {
    setState((s) => ({ replying: withKey(s.replying, m.channelId, m) }));
    window.dispatchEvent(new CustomEvent('bliscord:focus-composer'));
  };
  const startEdit = () => setState({ editing: m.id });
  const remove = (e) => {
    if (e?.shiftKey) { deleteMessage(m.id); return; }
    openModal('confirm', { title: 'Delete message', body: 'Are you sure you want to delete this message?', confirm: 'Delete', danger: true, onConfirm: () => deleteMessage(m.id) });
  };

  const menu = (e) => openMenu(e, [
    { label: 'Reply', icon: Icon.Reply, onClick: reply },
    ...(mine ? [{ label: 'Edit message', icon: Icon.Edit, onClick: startEdit }] : []),
    ...(m.content ? [{ label: 'Copy text', icon: Icon.Copy, onClick: () => copyText(m.content) }] : []),
    { label: 'Copy message ID', icon: Icon.Copy, onClick: () => copyText(m.id) },
    ...(mine || canModerate ? [{ separator: true }, { label: 'Delete message', icon: Icon.Trash, danger: true, onClick: () => remove() }] : []),
  ]);

  const replyAuthor = m.replyTo && !m.replyTo.deleted ? getState().users[m.replyTo.authorId] : null;

  return (
    <div
      className={`msg${grouped ? ' grouped' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}${mentioned ? ' mentioned' : ''}${isNew ? ' enter' : ''}${editing ? ' editing' : ''}${m.replyTo ? ' has-reply' : ''}`}
      data-id={m.id}
      onContextMenu={m.pending ? undefined : menu}
    >
      {m.replyTo && (
        <div className="msg-reply-ref" onClick={() => document.querySelector(`[data-id="${m.replyTo.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
          <span className="reply-spine" />
          {m.replyTo.deleted ? (
            <span className="reply-deleted">Original message was deleted</span>
          ) : (
            <>
              <Avatar user={replyAuthor} size={16} />
              <span className="reply-author">{displayName(replyAuthor)}</span>
              <span className="reply-snippet">{m.replyTo.content || (m.replyTo.hasAttachments ? 'Attachment' : '')}</span>
            </>
          )}
        </div>
      )}
      <div className="msg-gutter">
        {grouped ? (
          <span className="msg-hover-time">{timeOfDay(m.createdAt)}</span>
        ) : (
          <Avatar user={author} size={40} onClick={popout} className="clickable" />
        )}
      </div>
      <div className="msg-body">
        {!grouped && (
          <div className="msg-head">
            <span className="msg-author" onClick={popout} style={{ color: author?.accentColor || undefined }}>{name}</span>
            <VerifiedMark user={author} size={15} />
            {isOwnerAuthor && <Icon.Crown size={13} className="owner-crown" />}
            <span className="msg-time" data-tip={new Date(m.createdAt).toLocaleString()}>{messageTimestamp(m.createdAt)}</span>
          </div>
        )}
        {editing ? (
          <EditBox message={m} onDone={() => setState({ editing: null })} />
        ) : (
          m.content && (
            <div className="msg-content">
              {renderMarkdown(m.content, mentionCtx)}
              {m.editedAt && <span className="msg-edited" data-tip={new Date(m.editedAt).toLocaleString()}>(edited)</span>}
            </div>
          )
        )}
        {m.attachments?.length > 0 && (
          <div className="msg-attachments">
            {m.attachments.map((a, i) => <Attachment key={a.url + i} a={a} />)}
          </div>
        )}
        {m.failed && (
          <div className="msg-failed">
            <span>Not delivered</span>
            <button className="link-btn" onClick={() => retryMessage(m)}>Retry</button>
            <button className="link-btn" onClick={() => discardMessage(m)}>Discard</button>
          </div>
        )}
      </div>
      {!m.pending && !m.failed && !editing && (
        <div className="msg-actions">
          <button onClick={reply} data-tip="Reply"><Icon.Reply size={17} /></button>
          {mine && <button onClick={startEdit} data-tip="Edit"><Icon.Edit size={17} /></button>}
          {(mine || canModerate) && <button className="danger" onClick={remove} data-tip="Delete"><Icon.Trash size={17} /></button>}
          <button onClick={menu} data-tip="More"><Icon.More size={17} /></button>
        </div>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Message list                                                        */
/* ------------------------------------------------------------------ */

function MessageList({ channelId, serverId, intro }) {
  const bucket = useStore((s) => s.messages[channelId]);
  const users = useStore((s) => s.users);
  const members = useStore((s) => (serverId ? s.members[serverId] : null));
  const server = useStore((s) => (serverId ? s.servers[serverId] : null));
  const me = useStore((s) => s.me);
  const editing = useStore((s) => s.editing);
  const scroller = useRef(null);
  const inner = useRef(null);
  const atBottom = useRef(true);
  const lastHeight = useRef(0);
  const firstId = useRef(null);
  const [showJump, setShowJump] = useState(false);
  const openedAt = useMemo(() => ({ time: Date.now(), readId: getState().readStates[channelId] || '' }), [channelId]);

  useEffect(() => { loadMessages(channelId); }, [channelId]);

  const list = bucket?.list || [];
  const myRole = serverId ? members?.[me.id]?.role : null;
  const canModerate = myRole === 'owner' || myRole === 'admin';

  const mentionCtx = useMemo(() => ({
    meId: me.id,
    meUsername: me.username.replace(/\./g, '\\.'),
    resolveMention: (name) => {
      const lower = name.toLowerCase();
      return Object.values(users).find((u) => u.username.toLowerCase() === lower) || null;
    },
    onMentionClick: (userId, e) => openPopout(userId, e.currentTarget.getBoundingClientRect(), serverId),
  }), [me.id, me.username, users, serverId]);

  const stick = useCallback(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
    if (el) lastHeight.current = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    const ro = new ResizeObserver(stick);
    ro.observe(inner.current);
    ro.observe(el);
    const toBottom = (e) => {
      if (e.detail && e.detail !== channelId) return;
      atBottom.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };
    window.addEventListener('bliscord:scroll-bottom', toBottom);
    return () => { ro.disconnect(); window.removeEventListener('bliscord:scroll-bottom', toBottom); };
  }, [stick, channelId]);

  useLayoutEffect(() => {
    atBottom.current = true;
    firstId.current = null;
    setShowJump(false);
    const el = scroller.current;
    el.scrollTop = el.scrollHeight;
  }, [channelId]);

  // Keep the viewport steady when older messages are prepended above.
  useLayoutEffect(() => {
    const el = scroller.current;
    const first = list[0]?.id || null;
    if (firstId.current && first !== firstId.current && !atBottom.current && lastHeight.current) {
      el.scrollTop += el.scrollHeight - lastHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    firstId.current = first;
    lastHeight.current = el.scrollHeight;
  });

  // Mark messages read while the channel is open and focused.
  const lastId = list.length ? list[list.length - 1].id : null;
  useEffect(() => {
    const read = () => {
      if (document.hasFocus() && atBottom.current && lastId) markRead(channelId, getState().messages[channelId]?.list.filter((x) => !x.pending && !x.failed).at(-1)?.id);
    };
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, [channelId, lastId]);

  const onScroll = () => {
    const el = scroller.current;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < 32;
    lastHeight.current = el.scrollHeight;
    setShowJump(distance > 700);
    if (el.scrollTop < 400) loadOlder(channelId);
    if (atBottom.current && lastId) markRead(channelId, getState().messages[channelId]?.list.filter((x) => !x.pending && !x.failed).at(-1)?.id);
  };

  const rows = [];
  let unreadMarked = false;
  list.forEach((m, i) => {
    const prev = list[i - 1];
    const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt);
    if (newDay) rows.push(<div key={`d-${m.id}`} className="day-divider"><span>{dayLabel(m.createdAt)}</span></div>);
    if (!unreadMarked && openedAt.readId && m.id > openedAt.readId && m.authorId !== me.id && !m.pending && m.createdAt < openedAt.time) {
      unreadMarked = true;
      rows.push(<div key={`n-${m.id}`} className="new-divider"><span>New</span></div>);
    }
    const grouped = !newDay && prev && prev.authorId === m.authorId && prev.kind === 'default' && m.kind === 'default'
      && m.createdAt - prev.createdAt < GROUP_WINDOW && !m.replyTo;
    rows.push(
      <MessageItem
        key={m.nonce || m.id}
        message={m}
        grouped={grouped}
        author={users[m.authorId]}
        member={members?.[m.authorId]}
        meId={me.id}
        isOwnerAuthor={server?.ownerId === m.authorId}
        canModerate={canModerate}
        editing={editing === m.id}
        isNew={m.createdAt > openedAt.time}
        serverId={serverId}
        mentionCtx={mentionCtx}
      />,
    );
  });

  return (
    <div className="messages-wrap">
      <div className="messages-scroller" ref={scroller} onScroll={onScroll}>
        <div className="messages-inner" ref={inner}>
          {bucket?.loaded && !bucket.hasMore && intro}
          {(bucket?.loadingOlder || (bucket && !bucket.loaded)) && (
            <div className="messages-loading">
              {Array.from({ length: bucket.loaded ? 2 : 6 }).map((_, i) => (
                <div className="skeleton-msg" key={i} style={{ '--w': `${40 + ((i * 37) % 45)}%` }}>
                  <span className="sk-avatar" />
                  <span className="sk-lines"><span /><span /></span>
                </div>
              ))}
            </div>
          )}
          {rows}
          <div className="messages-spacer" />
        </div>
      </div>
      {showJump && (
        <button className="jump-present" onClick={() => window.dispatchEvent(new CustomEvent('bliscord:scroll-bottom', { detail: channelId }))}>
          <Icon.ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

function TypingIndicator({ channelId }) {
  const typing = useStore((s) => s.typing[channelId]);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me.id);
  const ids = Object.keys(typing || {}).filter((id) => id !== meId);
  if (!ids.length) return <div className="typing" />;
  const names = ids.map((id) => displayName(users[id]));
  let text;
  if (names.length === 1) text = <><b>{names[0]}</b> is typing</>;
  else if (names.length === 2) text = <><b>{names[0]}</b> and <b>{names[1]}</b> are typing</>;
  else if (names.length === 3) text = <><b>{names[0]}</b>, <b>{names[1]}</b> and <b>{names[2]}</b> are typing</>;
  else text = <>Several people are typing</>;
  return (
    <div className="typing active">
      <span className="typing-dots"><i /><i /><i /></span>
      <span>{text}</span>
    </div>
  );
}

function useMentionCandidates(channelId, serverId) {
  const users = useStore((s) => s.users);
  const members = useStore((s) => (serverId ? s.members[serverId] : null));
  const dm = useStore((s) => s.dms[channelId]);
  const meId = useStore((s) => s.me.id);
  return useMemo(() => {
    const ids = members ? Object.keys(members) : dm ? [dm.recipientId, meId] : [];
    return ids.map((id) => users[id]).filter(Boolean);
  }, [users, members, dm, meId]);
}

function Composer({ channelId, serverId, placeholder, files, setFiles, disabled }) {
  const [text, setText] = useState(drafts[channelId] || '');
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState(null);
  const replying = useStore((s) => s.replying[channelId]);
  const replyUser = useStore((s) => (replying ? s.users[replying.authorId] : null));
  const ref = useRef(null);
  const candidates = useMentionCandidates(channelId, serverId);

  useEffect(() => {
    setText(drafts[channelId] || '');
    ref.current?.focus();
  }, [channelId]);

  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener('bliscord:focus-composer', focus);
    return () => window.removeEventListener('bliscord:focus-composer', focus);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [text]);

  const matches = useMemo(() => {
    if (!mention) return [];
    const qy = mention.query.toLowerCase();
    return candidates
      .filter((u) => u.username.toLowerCase().startsWith(qy) || u.displayName.toLowerCase().startsWith(qy))
      .slice(0, 8);
  }, [mention, candidates]);

  const updateMention = (value, caret) => {
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([a-zA-Z0-9_.]{0,32})$/);
    setMention(m ? { query: m[2], start: caret - m[2].length - 1, index: 0 } : null);
  };

  const insertMention = (user) => {
    const el = ref.current;
    const caret = el.selectionStart;
    const next = `${text.slice(0, mention.start)}@${user.username} ${text.slice(caret)}`;
    setText(next);
    drafts[channelId] = next;
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + user.username.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const content = text.trim();
    if (sending || (!content && !files.length)) return;
    const pendingFiles = files;
    let attachments = [];
    if (pendingFiles.length) {
      setSending(true);
      try {
        attachments = await Promise.all(pendingFiles.map(async (f) => {
          const res = await uploadFile(f.file, (p) => setFiles((list) => list.map((x) => (x.id === f.id ? { ...x, progress: p } : x))));
          return { ...res, ...f.dims };
        }));
      } catch (err) {
        toast(err.message, 'error');
        setSending(false);
        return;
      }
      setSending(false);
    }
    const reply = getState().replying[channelId];
    sendMessage(channelId, { content, attachments, replyTo: reply });
    pendingFiles.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setFiles([]);
    setText('');
    drafts[channelId] = '';
    stopTyping(channelId);
    setState((s) => ({ replying: withoutKey(s.replying, channelId) }));
    window.dispatchEvent(new CustomEvent('bliscord:scroll-bottom', { detail: channelId }));
  };

  const onKeyDown = (e) => {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setMention((m) => ({ ...m, index: (m.index + d + matches.length) % matches.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(matches[mention.index] || matches[0]);
        return;
      }
      if (e.key === 'Escape') { setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && replying) {
      setState((s) => ({ replying: withoutKey(s.replying, channelId) }));
    } else if (e.key === 'ArrowUp' && !text) {
      const meId = getState().me.id;
      const own = getState().messages[channelId]?.list.filter((m) => m.authorId === meId && m.kind === 'default' && !m.pending).at(-1);
      if (own) { e.preventDefault(); setState({ editing: own.id }); }
    }
  };

  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted, setFiles);
    }
  };

  return (
    <div className="composer-wrap">
      {mention && matches.length > 0 && (
        <div className="mention-pop">
          {matches.map((u, i) => (
            <button
              key={u.id}
              className={`mention-opt${i === mention.index ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
              onMouseEnter={() => setMention((m) => ({ ...m, index: i }))}
            >
              <Avatar user={u} size={24} />
              <span className="mention-name">{u.displayName}</span>
              <span className="mention-user">@{u.username}</span>
            </button>
          ))}
        </div>
      )}
      <div className={`composer${replying ? ' replying' : ''}${disabled ? ' disabled' : ''}`}>
        {replying && (
          <div className="composer-reply">
            <span>Replying to <b>{displayName(replyUser)}</b></span>
            <button onClick={() => setState((s) => ({ replying: withoutKey(s.replying, channelId) }))} aria-label="Cancel reply">
              <Icon.X size={14} />
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((f) => (
              <div className="file-chip" key={f.id}>
                {f.preview ? <img src={f.preview} alt="" /> : <span className="file-chip-icon"><Icon.File size={28} /></span>}
                <span className="file-chip-name">{f.file.name}</span>
                {f.progress != null && f.progress < 1 && <span className="file-chip-progress" style={{ width: `${f.progress * 100}%` }} />}
                <button className="file-chip-remove" onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))} aria-label="Remove">
                  <Icon.Trash size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            className="composer-attach"
            onClick={async () => addFiles(await pickFiles({ multiple: true }), setFiles)}
            data-tip="Upload a file"
            disabled={disabled}
          >
            <Icon.PlusCircle size={22} />
          </button>
          <textarea
            ref={ref}
            className="composer-input"
            rows={1}
            value={text}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              drafts[channelId] = e.target.value;
              if (e.target.value.trim()) sendTyping(channelId);
              updateMention(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => setTimeout(() => setMention(null), 100)}
          />
          <button className={`composer-send${text.trim() || files.length ? ' ready' : ''}`} onClick={submit} disabled={sending || disabled} data-tip="Send">
            {sending ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <Icon.Send size={18} />}
          </button>
        </div>
      </div>
      <TypingIndicator channelId={channelId} />
    </div>
  );
}

async function addFiles(list, setFiles) {
  const MAX = 25 * 1024 * 1024;
  const items = [];
  for (const raw of list.slice(0, 10)) {
    if (raw.size > MAX) { toast(`${raw.name} is larger than 25 MB`, 'error'); continue; }
    const file = raw.type.startsWith('image/') ? await prepareImage(raw, 2560) : raw;
    items.push({
      id: nonce(),
      file,
      dims: await imageSize(file),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      progress: null,
    });
  }
  setFiles((cur) => [...cur, ...items].slice(0, 10));
}

/* ------------------------------------------------------------------ */
/* Chat pane (list + composer + drop zone)                             */
/* ------------------------------------------------------------------ */

function ChatPane({ channelId, serverId, placeholder, intro, disabled }) {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => { setFiles([]); }, [channelId]);

  return (
    <div
      className="chat-pane"
      onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { depth.current += 1; setDragging(true); } }}
      onDragLeave={() => { depth.current -= 1; if (depth.current <= 0) { depth.current = 0; setDragging(false); } }}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!disabled) addFiles([...e.dataTransfer.files], setFiles);
      }}
    >
      <MessageList channelId={channelId} serverId={serverId} intro={intro} />
      <Composer channelId={channelId} serverId={serverId} placeholder={placeholder} files={files} setFiles={setFiles} disabled={disabled} />
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Icon.Upload size={34} />
            <span>Drop to upload</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export function ChannelView({ channelId }) {
  const channel = useStore((s) => s.channels[channelId]);
  const showMembers = useStore((s) => s.showMembers);
  const canManage = useStore((s) => {
    const role = s.members[channel?.serverId]?.[s.me.id]?.role;
    return role === 'owner' || role === 'admin';
  });
  if (!channel) return null;

  const intro = (
    <div className="channel-intro">
      <div className="intro-badge"><Icon.Hash size={36} /></div>
      <h1>Welcome to #{channel.name}</h1>
      <p>This is the start of the #{channel.name} channel.</p>
      {canManage && (
        <Button variant="soft" onClick={() => openModal('channelSettings', { channelId })}>
          <Icon.Edit size={15} /> Edit channel
        </Button>
      )}
    </div>
  );

  return (
    <div className="chat">
      <ChatHeader icon={<Icon.Hash size={22} className="header-icon" />} title={channel.name} topic={channel.topic}>
        <IconButton
          icon={Icon.Users}
          tip={showMembers ? 'Hide members' : 'Show members'}
          side="bottom"
          active={showMembers}
          onClick={() => setState((s) => ({ showMembers: !s.showMembers }))}
        />
      </ChatHeader>
      <ChatPane channelId={channelId} serverId={channel.serverId} placeholder={`Message #${channel.name}`} intro={intro} />
    </div>
  );
}

export function DmView({ dmId }) {
  const dm = useStore((s) => s.dms[dmId]);
  const user = useStore((s) => s.users[s.dms[dmId]?.recipientId]);
  const relationship = useStore((s) => s.relationships[s.dms[dmId]?.recipientId]);
  const callActive = useStore((s) => (s.voice[dmId] || []).length > 0);
  const showMembers = useStore((s) => s.showMembers);
  const v = useVoice();
  if (!dm || !user) return null;
  const inThisCall = v.roomId === dmId;
  const blocked = relationship === 'blocked';

  const intro = (
    <div className="channel-intro dm-intro">
      <Avatar user={user} size={84} />
      <h1>{displayName(user)}</h1>
      <p className="intro-username">@{user.username}</p>
      <p>This is the beginning of your conversation with <b>{displayName(user)}</b>.</p>
      <div className="intro-actions">
        {relationship === 'friend' && <Button variant="soft" onClick={() => removeFriend(user.id)}>Remove friend</Button>}
        {relationship === 'incoming' && <Button onClick={() => acceptFriend(user.id)}>Accept request</Button>}
        {relationship === 'outgoing' && <Button variant="soft" disabled>Request sent</Button>}
        {!relationship && <Button onClick={() => addFriendById(user.id)}>Add friend</Button>}
        {blocked ? (
          <Button variant="soft" onClick={() => unblockUser(user.id)}>Unblock</Button>
        ) : (
          <Button variant="soft" onClick={() => blockUser(user.id)}>Block</Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="chat">
      <ChatHeader
        icon={<Avatar user={user} size={26} status={user.presence} />}
        title={displayName(user)}
        onTitleClick={(e) => openPopout(user.id, e.currentTarget.getBoundingClientRect())}
      >
        {!inThisCall && !blocked && (
          <>
            <IconButton icon={Icon.Phone} tip="Start voice call" side="bottom" onClick={() => startCall(dmId)} />
            <IconButton icon={Icon.Video} tip="Start video call" side="bottom" onClick={() => startCall(dmId, { video: true })} />
          </>
        )}
        <IconButton
          icon={Icon.User}
          tip={showMembers ? 'Hide profile' : 'Show profile'}
          side="bottom"
          active={showMembers}
          onClick={() => setState((s) => ({ showMembers: !s.showMembers }))}
        />
      </ChatHeader>
      {(callActive || inThisCall) && <CallStage roomId={dmId} />}
      <ChatPane
        channelId={dmId}
        placeholder={blocked ? 'You cannot message this user' : `Message @${displayName(user)}`}
        intro={intro}
        disabled={blocked}
      />
    </div>
  );
}
