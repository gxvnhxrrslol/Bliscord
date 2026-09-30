import { useEffect, useMemo, useState } from 'react';
import { getState, useStore } from '../lib/store';
import {
  addFriendById, banMember, blockUser, fetchProfile, kickMember, openDm, openMenu, openModal, openPopout, removeFriend,
  selectServer, toggleMemberRole, transferServer,
} from '../lib/actions';
import { assetUrl } from '../lib/api';
import { colorFor, displayName, fullDate } from '../lib/format';
import { has, myTopPosition, P, permsFor, roleColor } from '../lib/perms';
import { Avatar, Button, ServerGlyph, copyText } from './ui';
import { Badges, VerifiedMark } from './Badges';
import { ProfileEffect, StyledName, profileThemeStyle } from './Cosmetics';
import Icon from './Icons';

/* ------------------------------------------------------------------ */
/* Role picking                                                        */
/* ------------------------------------------------------------------ */

function RolePicker({ serverId, userId }) {
  const roles = useStore((s) => s.roles[serverId] || []);
  const mine = useStore((s) => s.members[serverId]?.[userId]?.roles || []);
  const top = useStore((s) => myTopPosition(s, serverId));
  const list = roles.filter((r) => r.id !== serverId);
  if (!list.length) return <div className="menu-custom"><span className="menu-custom-label">No roles yet</span></div>;
  return (
    <div className="role-picker">
      {list.map((r) => {
        const locked = r.position >= top;
        const on = mine.includes(r.id);
        return (
          <button key={r.id} className={`role-pick${on ? ' on' : ''}`} disabled={locked} onClick={() => toggleMemberRole(serverId, userId, r.id)}>
            <span className="role-dot" style={{ background: r.color || 'var(--text-3)' }} />
            <span className="role-pick-name">{r.name}</span>
            <span className="role-check">{on && <Icon.Check size={14} strokeWidth={2.6} />}</span>
          </button>
        );
      })}
    </div>
  );
}

export function openRolePicker(e, serverId, userId) {
  openMenu(e, [{ render: () => <RolePicker serverId={serverId} userId={userId} /> }]);
}

export function memberMenu(e, { userId, serverId }) {
  const s = getState();
  const meId = s.me.id;
  const isMe = userId === meId;
  const server = s.servers[serverId];
  const perms = permsFor(s, serverId);
  const outranks = userId !== server?.ownerId && myTopPosition(s, serverId) > topOf(s, serverId, userId);
  const items = [
    { label: 'Profile', icon: Icon.User, onClick: () => openPopout(userId, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 }, serverId) },
  ];
  if (!isMe) items.push({ label: 'Message', icon: Icon.Message, onClick: () => openDm(userId) });
  items.push({ label: 'Copy user ID', icon: Icon.Copy, onClick: () => copyText(userId) });
  const mod = [];
  if (has(perms, P.MANAGE_ROLES)) mod.push({ label: 'Roles', icon: Icon.Tag, onClick: () => setTimeout(() => openRolePicker(e, serverId, userId), 0) });
  if ((isMe && has(perms, P.CHANGE_NICKNAME)) || (!isMe && outranks && has(perms, P.MANAGE_NICKNAMES))) {
    mod.push({ label: 'Change nickname', icon: Icon.Edit, onClick: () => openModal('nickname', { serverId, userId }) });
  }
  if (!isMe && outranks && has(perms, P.KICK_MEMBERS)) {
    mod.push({ label: 'Kick', icon: Icon.Logout, danger: true, onClick: () => openModal('confirm', {
      title: `Kick ${displayName(s.users[userId])}`,
      body: 'They can rejoin with a new invite.',
      confirm: 'Kick',
      danger: true,
      onConfirm: () => kickMember(serverId, userId),
    }) });
  }
  if (!isMe && outranks && has(perms, P.BAN_MEMBERS)) {
    mod.push({ label: 'Ban', icon: Icon.Block, danger: true, onClick: () => openModal('confirm', {
      title: `Ban ${displayName(s.users[userId])}`,
      body: 'They will be removed and cannot rejoin until unbanned.',
      confirm: 'Ban',
      danger: true,
      onConfirm: () => banMember(serverId, userId),
    }) });
  }
  if (server?.ownerId === meId && !isMe) {
    mod.push({ label: 'Transfer ownership', icon: Icon.Crown, danger: true, onClick: () => openModal('confirm', {
      title: 'Transfer ownership',
      body: `Make ${displayName(s.users[userId])} the owner of ${server.name}?`,
      confirm: 'Transfer',
      danger: true,
      onConfirm: () => transferServer(serverId, userId),
    }) });
  }
  if (mod.length) items.push({ separator: true }, ...mod);
  openMenu(e, items);
}

function topOf(s, serverId, userId) {
  const ids = s.members[serverId]?.[userId]?.roles || [];
  return (s.roles[serverId] || []).filter((r) => ids.includes(r.id)).reduce((m, r) => Math.max(m, r.position), 0);
}

/* ------------------------------------------------------------------ */
/* Member list                                                         */
/* ------------------------------------------------------------------ */

function MemberRow({ member, user, serverId, isOwner, color }) {
  const inVoice = useStore((s) => Object.entries(s.voice).some(([rid, st]) => s.channels[rid]?.serverId === serverId && st.some((p) => p.userId === user.id)));
  return (
    <div
      className={`member-row${user.presence === 'offline' ? ' offline' : ''}`}
      onClick={(e) => openPopout(user.id, e.currentTarget.getBoundingClientRect(), serverId)}
      onContextMenu={(e) => memberMenu(e, { userId: user.id, serverId })}
    >
      <Avatar user={user} size={32} status={user.presence} />
      <div className="member-text">
        <span className="member-name">
          <StyledName user={user} color={color}>{displayName(user, member)}</StyledName>
          <VerifiedMark user={user} size={14} />
          {isOwner && <Icon.Crown size={13} className="owner-crown" />}
        </span>
        {user.customStatus && <span className="member-sub">{user.customStatus}</span>}
      </div>
      {inVoice && <Icon.Speaker size={15} className="member-voice" />}
    </div>
  );
}

export function MemberList({ serverId }) {
  const members = useStore((s) => s.members[serverId]);
  const users = useStore((s) => s.users);
  const roles = useStore((s) => s.roles[serverId] || []);
  const server = useStore((s) => s.servers[serverId]);

  const groups = useMemo(() => {
    const list = Object.values(members || {}).map((m) => ({ member: m, user: users[m.userId] })).filter((x) => x.user);
    const sort = (a, b) => displayName(a.user, a.member).localeCompare(displayName(b.user, b.member));
    const hoisted = roles.filter((r) => r.hoist && r.id !== serverId);
    const out = hoisted.map((r) => ({ key: r.id, title: r.name, items: [] }));
    const online = { key: 'online', title: 'Online', items: [] };
    const offline = { key: 'offline', title: 'Offline', items: [] };
    for (const x of list) {
      const colorRole = roles.find((r) => r.color && x.member.roles?.includes(r.id));
      const item = { ...x, color: colorRole?.color || null };
      if (x.user.presence === 'offline') { offline.items.push(item); continue; }
      const idx = hoisted.findIndex((r) => x.member.roles?.includes(r.id));
      (idx >= 0 ? out[idx] : online).items.push(item);
    }
    return [...out, online, offline].filter((g) => g.items.length).map((g) => ({ ...g, items: g.items.sort(sort) }));
  }, [members, users, roles, serverId]);

  return (
    <aside className="members panel glass">
      <div className="members-scroll">
        {groups.map((g) => (
          <div key={g.key} className="member-group">
            <div className="member-group-title">{g.title} - {g.items.length}</div>
            {g.items.map(({ member, user, color }) => (
              <MemberRow key={user.id} member={member} user={user} serverId={serverId} isOwner={server?.ownerId === user.id} color={color} />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Profile card                                                        */
/* ------------------------------------------------------------------ */

function RoleChips({ serverId, userId }) {
  const roles = useStore((s) => s.roles[serverId] || []);
  const mine = useStore((s) => s.members[serverId]?.[userId]?.roles || []);
  const canManage = useStore((s) => has(permsFor(s, serverId), P.MANAGE_ROLES));
  const top = useStore((s) => myTopPosition(s, serverId));
  const list = roles.filter((r) => mine.includes(r.id));
  if (!list.length && !canManage) return null;
  return (
    <>
      <h4>Roles</h4>
      <div className="role-chips">
        {list.map((r) => (
          <span key={r.id} className="role-chip">
            <button
              className="role-chip-dot"
              style={{ background: r.color || 'var(--text-3)' }}
              disabled={!canManage || r.position >= top}
              onClick={() => toggleMemberRole(serverId, userId, r.id)}
              data-tip={canManage && r.position < top ? 'Remove role' : undefined}
            >
              {canManage && r.position < top && <Icon.X size={9} strokeWidth={3.4} />}
            </button>
            {r.name}
          </span>
        ))}
        {canManage && (
          <button className="role-chip add" onClick={(e) => openRolePicker(e, serverId, userId)} data-tip="Add role">
            <Icon.Plus size={13} strokeWidth={2.6} />
          </button>
        )}
      </div>
    </>
  );
}

export function ProfileCard({ userId, serverId, compact = false, onAction }) {
  const user = useStore((s) => s.users[userId]);
  const me = useStore((s) => s.me);
  const member = useStore((s) => (serverId ? s.members[serverId]?.[userId] : null));
  const color = useStore((s) => roleColor(s, serverId, userId));
  const relationship = useStore((s) => s.relationships[userId]);
  const servers = useStore((s) => s.servers);
  const [extra, setExtra] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchProfile(userId).then((d) => alive && setExtra(d)).catch(() => {});
    return () => { alive = false; };
  }, [userId]);

  if (!user) return null;
  const isMe = userId === me.id;
  const banner = assetUrl(user.banner);
  const bannerColor = user.bannerColor || user.accentColor || colorFor(user.id);
  const themed = Boolean(user.profile?.themeColors);

  return (
    <div
      className={`profile-card${compact ? ' compact' : ''}${themed ? ' themed' : ''}`}
      style={{ '--profile-accent': user.accentColor || bannerColor, ...profileThemeStyle(user) }}
    >
      <div className="profile-banner" style={{ background: banner ? undefined : bannerColor }}>
        {banner && <img src={banner} alt="" draggable={false} />}
      </div>
      <ProfileEffect id={user.profile?.effect} />
      <div className="profile-avatar-wrap">
        <Avatar user={user} size={84} status={user.presence} className="profile-avatar" />
      </div>
      <Badges user={user} className="profile-badges" />
      <div className="profile-body">
        <div className="profile-names">
          <h3><StyledName user={user} color={color}>{displayName(user, member)}</StyledName><VerifiedMark user={user} size={18} /></h3>
          <div className="profile-username">
            @{user.username}
            {user.pronouns && <span className="profile-pronouns">{user.pronouns}</span>}
          </div>
        </div>
        {user.customStatus && <div className="profile-status">{user.customStatus}</div>}
        {!isMe && (
          <div className="profile-actions">
            <Button onClick={() => { onAction?.(); openDm(userId); }}><Icon.Message size={16} /> Message</Button>
            {relationship === 'friend' ? (
              <Button variant="soft" data-tip="Remove friend" onClick={() => removeFriend(userId)}><Icon.UserX size={16} /></Button>
            ) : relationship === 'incoming' || relationship === 'outgoing' ? (
              <Button variant="soft" disabled><Icon.Check size={16} /></Button>
            ) : relationship !== 'blocked' && (
              <Button variant="soft" data-tip="Add friend" onClick={() => addFriendById(userId)}><Icon.UserPlus size={16} /></Button>
            )}
            <Button variant="soft" data-tip="More" onClick={(e) => (serverId ? memberMenu(e, { userId, serverId }) : openMenu(e, [
              { label: 'Copy username', icon: Icon.Copy, onClick: () => copyText(user.username) },
              { label: 'Copy user ID', icon: Icon.Copy, onClick: () => copyText(user.id) },
              { separator: true },
              { label: 'Block', icon: Icon.Block, danger: true, onClick: () => blockUser(userId) },
            ]))}><Icon.More size={16} /></Button>
          </div>
        )}
        {isMe && (
          <div className="profile-actions">
            <Button variant="soft" onClick={() => { onAction?.(); openModal('settings', { tab: 'profile' }); }}><Icon.Edit size={16} /> Edit profile</Button>
          </div>
        )}
        <div className="profile-section">
          {user.bio && (
            <>
              <h4>About me</h4>
              <p className="profile-bio">{user.bio}</p>
            </>
          )}
          <h4>Member since</h4>
          <div className="profile-since">
            <span><Icon.Logo size={14} /> {fullDate(user.createdAt)}</span>
            {member && (
              <span><ServerGlyph server={servers[serverId]} size={16} /> {fullDate(member.joinedAt)}</span>
            )}
          </div>
          {serverId && member && <RoleChips serverId={serverId} userId={userId} />}
          {!isMe && extra && (extra.mutualServers.length > 0 || extra.mutualFriends.length > 0) && (
            <>
              <h4>In common</h4>
              <div className="profile-mutuals">
                {extra.mutualServers.map((id) => servers[id] && (
                  <button key={id} className="mutual-server" onClick={() => { onAction?.(); selectServer(id); }} data-tip={servers[id].name}>
                    <ServerGlyph server={servers[id]} size={28} />
                  </button>
                ))}
                {extra.mutualFriends.length > 0 && (
                  <span className="mutual-friends">{extra.mutualFriends.length} mutual friend{extra.mutualFriends.length === 1 ? '' : 's'}</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function DmProfile({ dmId }) {
  const userId = useStore((s) => s.dms[dmId]?.recipientId);
  if (!userId) return null;
  return (
    <aside className="members panel glass dm-profile">
      <div className="members-scroll">
        <ProfileCard key={userId} userId={userId} />
      </div>
    </aside>
  );
}
