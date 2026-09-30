import { computePermissions, has, P } from '../../shared/permissions.js';
import { serverPermData } from '../lib/perms';
import Icon from './Icons';

/** A channel is private when a member with no roles cannot see it. */
export function isPrivateChannel(state, channel) {
  if (!channel) return false;
  const data = serverPermData(state, channel.serverId);
  if (!data) return false;
  const nobody = { ...data, ownerId: null, memberRoles: () => [] };
  return !has(computePermissions(nobody, '__nobody__', channel.id), P.VIEW_CHANNEL);
}

export function ChannelIcon({ channel, server, isPrivate = false, size = 18, className = '' }) {
  if (!channel) return null;
  if (channel.type === 'voice') return isPrivate ? <Icon.SpeakerLock size={size} className={className} /> : <Icon.Speaker size={size} className={className} />;
  if (server?.rulesChannelId === channel.id) return <Icon.Book size={size} className={className} />;
  if (channel.type === 'announcement') return <Icon.Megaphone size={size} className={className} />;
  return isPrivate ? <Icon.HashLock size={size} className={className} /> : <Icon.Hash size={size} className={className} />;
}

export const CHANNEL_TYPE_LABELS = { text: 'Text', voice: 'Voice', announcement: 'Announcement', category: 'Category' };
