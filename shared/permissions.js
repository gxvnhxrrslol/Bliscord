// Permission system shared by the server and the app, modeled on Discord's.
// Base permissions come from @everyone plus the member's roles; channel
// overwrites then apply in order: @everyone, the member's roles, the member.

export const P = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  READ_HISTORY: 1 << 2,
  ATTACH_FILES: 1 << 3,
  MENTION_EVERYONE: 1 << 4,
  MANAGE_MESSAGES: 1 << 5,
  CONNECT: 1 << 6,
  SPEAK: 1 << 7,
  VIDEO: 1 << 8,
  MUTE_MEMBERS: 1 << 9,
  DEAFEN_MEMBERS: 1 << 10,
  MOVE_MEMBERS: 1 << 11,
  CREATE_INVITE: 1 << 12,
  CHANGE_NICKNAME: 1 << 13,
  MANAGE_NICKNAMES: 1 << 14,
  KICK_MEMBERS: 1 << 15,
  BAN_MEMBERS: 1 << 16,
  MANAGE_CHANNELS: 1 << 17,
  MANAGE_ROLES: 1 << 18,
  MANAGE_SERVER: 1 << 19,
  ADMINISTRATOR: 1 << 20,
};

export const ALL = (1 << 21) - 1;

export const DEFAULT_EVERYONE = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_HISTORY | P.ATTACH_FILES | P.CONNECT
  | P.SPEAK | P.VIDEO | P.CREATE_INVITE | P.CHANGE_NICKNAME;

/** Permissions that make sense per channel (used in channel overwrites). */
export const CHANNEL_SCOPED = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_HISTORY | P.ATTACH_FILES | P.MENTION_EVERYONE
  | P.MANAGE_MESSAGES | P.CONNECT | P.SPEAK | P.VIDEO | P.MUTE_MEMBERS | P.DEAFEN_MEMBERS | P.MOVE_MEMBERS
  | P.CREATE_INVITE | P.MANAGE_CHANNELS | P.MANAGE_ROLES;

export const PERMISSION_GROUPS = [
  {
    title: 'General',
    items: [
      ['VIEW_CHANNEL', 'View Channels'],
      ['MANAGE_CHANNELS', 'Manage Channels'],
      ['MANAGE_ROLES', 'Manage Roles'],
      ['MANAGE_SERVER', 'Manage Server'],
      ['CREATE_INVITE', 'Create Invite'],
      ['CHANGE_NICKNAME', 'Change Nickname'],
      ['MANAGE_NICKNAMES', 'Manage Nicknames'],
      ['KICK_MEMBERS', 'Kick Members'],
      ['BAN_MEMBERS', 'Ban Members'],
    ],
  },
  {
    title: 'Text',
    items: [
      ['SEND_MESSAGES', 'Send Messages'],
      ['READ_HISTORY', 'Read Message History'],
      ['ATTACH_FILES', 'Attach Files'],
      ['MENTION_EVERYONE', 'Mention @everyone and All Roles'],
      ['MANAGE_MESSAGES', 'Manage Messages'],
    ],
  },
  {
    title: 'Voice',
    items: [
      ['CONNECT', 'Connect'],
      ['SPEAK', 'Speak'],
      ['VIDEO', 'Video and Screen Share'],
      ['MUTE_MEMBERS', 'Mute Members'],
      ['DEAFEN_MEMBERS', 'Deafen Members'],
      ['MOVE_MEMBERS', 'Disconnect Members'],
    ],
  },
  {
    title: 'Advanced',
    items: [['ADMINISTRATOR', 'Administrator']],
  },
];

export const has = (perms, flag) => (perms & flag) === flag;

/**
 * @param {object} s  server data:
 *   ownerId, everyoneId, roles: [{ id, permissions, position }],
 *   memberRoles(userId) -> role ids, channel(id) -> { parentId, synced, overwrites: [{ id, type, allow, deny }] }
 */
export function computePermissions(s, userId, channelId = null) {
  if (userId === s.ownerId) return ALL;
  const byId = new Map(s.roles.map((r) => [r.id, r]));
  const mine = s.memberRoles(userId) || [];
  let perms = byId.get(s.everyoneId)?.permissions || 0;
  for (const id of mine) perms |= byId.get(id)?.permissions || 0;
  if (has(perms, P.ADMINISTRATOR)) return ALL;
  if (!channelId) return perms;

  const channel = s.channel(channelId);
  if (!channel) return 0;
  const source = channel.synced && channel.parentId ? s.channel(channel.parentId) || channel : channel;
  const overwrites = source.overwrites || [];

  const everyone = overwrites.find((o) => o.id === s.everyoneId);
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow;
  let allow = 0;
  let deny = 0;
  for (const o of overwrites) {
    if (o.type === 'role' && o.id !== s.everyoneId && mine.includes(o.id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  perms = (perms & ~deny) | allow;
  const member = overwrites.find((o) => o.type === 'member' && o.id === userId);
  if (member) perms = (perms & ~member.deny) | member.allow;

  if (!has(perms, P.VIEW_CHANNEL)) return 0;
  return perms;
}

/** Highest role position a member holds (the owner outranks everyone). */
export function topPosition(s, userId) {
  if (userId === s.ownerId) return Infinity;
  const mine = new Set(s.memberRoles(userId) || []);
  let top = 0;
  for (const r of s.roles) if (mine.has(r.id) && r.position > top) top = r.position;
  return top;
}
