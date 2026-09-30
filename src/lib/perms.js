import { computePermissions, has, P, topPosition } from '../../shared/permissions.js';
import { useStore } from './store';

export { P, has };

/** Builds the permission-engine view of a server from app state. */
export function serverPermData(state, serverId) {
  const server = state.servers[serverId];
  if (!server) return null;
  const members = state.members[serverId] || {};
  return {
    ownerId: server.ownerId,
    everyoneId: serverId,
    roles: state.roles[serverId] || [],
    memberRoles: (uid) => members[uid]?.roles || [],
    channel: (id) => {
      const c = state.channels[id];
      return c ? { parentId: c.parentId, synced: c.synced, overwrites: c.overwrites || [] } : null;
    },
  };
}

export function permsFor(state, serverId, channelId = null, userId = state.me?.id) {
  const data = serverPermData(state, serverId);
  return data ? computePermissions(data, userId, channelId) : 0;
}

export function can(state, serverId, flag, channelId = null) {
  return has(permsFor(state, serverId, channelId), flag);
}

/** React hook: my permission bits in a server (optionally a channel). */
export function usePerms(serverId, channelId = null) {
  return useStore((s) => (serverId ? permsFor(s, serverId, channelId) : 0));
}

export function myTopPosition(state, serverId) {
  const data = serverPermData(state, serverId);
  return data ? topPosition(data, state.me.id) : 0;
}

/** Roles of a member, highest first. */
export function memberRoleList(state, serverId, userId) {
  const ids = new Set(state.members[serverId]?.[userId]?.roles || []);
  return (state.roles[serverId] || []).filter((r) => ids.has(r.id));
}

/** The color a member's name shows in: their highest colored role. */
export function roleColor(state, serverId, userId) {
  if (!serverId) return null;
  return memberRoleList(state, serverId, userId).find((r) => r.color)?.color || null;
}
