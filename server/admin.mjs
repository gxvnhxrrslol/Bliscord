// Server admin tool. Badges can only be granted here, never through the app.
//
//   node server/admin.mjs badges <username>                      show a user's badges
//   node server/admin.mjs badges <username> add <badge...>       grant badges
//   node server/admin.mjs badges <username> remove <badge...>    take badges away
//
// Badges: founder, developer, verified, staff, early
// Online users see the change after their app reconnects (or restart the server).
import { q } from './db.js';

const BADGES = ['founder', 'developer', 'verified', 'staff', 'early'];
const [command, username, action, ...names] = process.argv.slice(2);

if (command !== 'badges' || !username) {
  console.log('Usage: node server/admin.mjs badges <username> [add|remove <badge...>]');
  console.log(`Badges: ${BADGES.join(', ')}`);
  process.exit(1);
}

const user = q('SELECT id, username, badges FROM users WHERE username = ?').get(username.toLowerCase());
if (!user) {
  console.error(`No user named ${username}`);
  process.exit(1);
}

let badges = JSON.parse(user.badges || '[]');
if (action === 'add' || action === 'remove') {
  const unknown = names.filter((n) => !BADGES.includes(n));
  if (unknown.length || !names.length) {
    console.error(`Unknown badge(s): ${unknown.join(', ') || '(none given)'}. Valid: ${BADGES.join(', ')}`);
    process.exit(1);
  }
  badges = action === 'add'
    ? [...new Set([...badges, ...names])]
    : badges.filter((b) => !names.includes(b));
  badges.sort((a, b) => BADGES.indexOf(a) - BADGES.indexOf(b));
  q('UPDATE users SET badges = ? WHERE id = ?').run(JSON.stringify(badges), user.id);
}

console.log(`${user.username}: ${badges.length ? badges.join(', ') : '(no badges)'}`);
