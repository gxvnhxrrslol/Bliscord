// Writes build/release-notes.md from src/changelog.json for the current version.
// electron-builder uses that file as the GitHub release description.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const changelog = JSON.parse(fs.readFileSync(path.join(root, 'src', 'changelog.json'), 'utf8'));
const entry = changelog.find((e) => e.version === version);
const text = entry ? `## ${entry.title}\n\n${entry.items.map((i) => `- ${i}`).join('\n')}\n` : `Bliscord ${version}\n`;
fs.writeFileSync(path.join(root, 'build', 'release-notes.md'), text);
console.log(text);
