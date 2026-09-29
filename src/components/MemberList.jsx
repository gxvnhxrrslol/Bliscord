import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import {
  addFriendById, fetchProfile, kickMember, openDm, openMenu, openModal, openPopout, setMemberRole, transferServer,
  removeFriend, blockUser, selectServer,
} from '../lib/actions';
import { assetUrl } from '../lib/api';
import { colorFor, displayName, fullDate } from '../lib/format';
import { Avatar, Button, ServerGlyph, copyText } from './ui';
import Icon from './Icons';

export function memberMenu(e, { userId, serverId, meId, myRole, theirRole, server }) {
  const isMe = userId === meId;
  const canKick = !isMe && (myRole === 'owner' || (myRole === 'admin' && theirRole === 'member'));
  const items = [
    { label: 'Profile', icon: Icon.User, onClick: () => openPopout(userId, { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 }, serverId) },
  ];
  if (!isMe) items.push({ label: 'Message', icon: Icon.Message, onClick: () => openDm(userId) });
  items.push({ label: 'Copy user ID', icon: Icon.Copy, onClick: () => copyText(userId) });
  if (myRole === 'owner' && !isMe) {
    items.push({ separator: true });
    items.push(theirRole === 'admin'
      ? { label: 'Remove admin', icon: Icon.Shield, onClick: () => setMemberRole(serverId, userId, 'member') }
      : { label: 'Make admin', icon: Icon.Shield, onClick: () => setMemberRole(serverId, userId, 'admin') });
    items.push({ label: 'Transfer ownership', icon: Icon.Crown, onClick: () => openModal('confirm', {
      title: 'Transfer ownership',
      body: `Make this member the owner of ${server?.name}? You will become an admin.`,
      confirm: 'Transfer',
      danger: true,
      onConfirm: () => transferServer(serverId, userId),
    }) });
  }
  if (canKick) {
    items.push({ label: 'Kick', icon: Icon.Logout, danger: true, onClick: () => openModal('confirm', {
      title: 'Kick member',
      body: 'They can rejoin with a new invite.',
      confirm: 'Kick',
      danger: true,
      onConfirm: () => kickMember(serverId, userId),
    }) });
  }
  openMenu(e, items);
}

function MemberRow({ member, user, serverId, isOwner, meId, myRole, server }) {
  const inVoice = useStore((s) => Object.entries(s.voice).some(([rid, st]) => s.channels[rid]?.serverId === serverId && st.some((p) => p.userId === user.id)));
  return (
    <div
      className={`member-row${user.presence === 'offline' ? ' offline' : ''}`}
      onClick={(e) => openPopout(user.id, e.currentTarget.getBoundingClientRect(), serverId)}
      onContextMenu={(e) => memberMenu(e, { userId: user.id, serverId, meId, myRole, theirRole: member.role, server })}
    >
      <Avatar user={user} size={32} status={user.presence} />
      <div className="member-text">
        <span className="member-name" style={{ color: user.accentColor || undefined }}>
          {displayName(user, member)}
          {isOwner && <Icon.Crown size={13} className="owner-crown" />}
          {member.role === 'admin' && <Icon.Shield size={13} className="admin-shield" />}
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
  const server = useStore((s) => s.servers[serverId]);
  const meId = useStore((s) => s.me.id);
  const myRole = members?.[meId]?.role;

  const groups = useMemo(() => {
    const list = Object.values(members || {}).map((m) => ({ member: m, user: users[m.userId] })).filter((x) => x.user);
    const sort = (a, b) => displayName(a.user, a.member).localeCompare(displayName(b.user, b.member));
    return {
      online: list.filter((x) => x.user.presence !== 'offline').sort(sort),
      offline: list.filter((x) => x.user.presence === 'offline').sort(sort),
    };
  }, [members, users]);

  return (
    <aside className="members panel glass">
      <div className="members-scroll">
        {['online', 'offline'].map((k) => groups[k].length > 0 && (
          <div key={k} className="member-group">
            <div className="member-group-title">{k === 'online' ? 'Online' : 'Offline'} - {groups[k].length}</div>
            {groups[k].map(({ member, user }) => (
              <MemberRow
                key={user.id}
                member={member}
                user={user}
                serverId={serverId}
                isOwner={server?.ownerId === user.id}
                meId={meId}
                myRole={myRole}
                server={server}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function ProfileCard({ userId, serverId, compact = false, onAction }) {
  const user = useStore((s) => s.users[userId]);
  const me = useStore((s) => s.me);
  const member = useStore((s) => (serverId ? s.members[serverId]?.[userId] : null));
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

  return (
    <div className={`profile-card${compact ? ' compact' : ''}`} style={{ '--profile-accent': user.accentColor || bannerColor }}>
      <div className="profile-banner" style={{ background: banner ? undefined : bannerColor }}>
        {banner && <img src={banner} alt="" draggable={false} />}
      </div>
      <div className="profile-avatar-wrap">
        <Avatar user={user} size={84} status={user.presence} className="profile-avatar" />
      </div>
      <div className="profile-body">
        <div className="profile-names">
          <h3>{displayName(user, member)}</h3>
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
            <Button variant="soft" data-tip="More" onClick={(e) => openMenu(e, [
              { label: 'Copy username', icon: Icon.Copy, onClick: () => copyText(user.username) },
              { label: 'Copy user ID', icon: Icon.Copy, onClick: () => copyText(user.id) },
              { separator: true },
              { label: 'Block', icon: Icon.Block, danger: true, onClick: () => blockUser(userId) },
            ])}><Icon.More size={16} /></Button>
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
