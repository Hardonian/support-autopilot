import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HELP_MARKER_START = '<!-- CLI_COMMANDS_START -->';
const HELP_MARKER_END = '<!-- CLI_COMMANDS_END -->';

function getHelpOutput() {
  return execSync('node dist/cli.js --help', { encoding: 'utf-8' });
}

function parseCommands(helpOutput) {
  const lines = helpOutput.split('\n');
  const startIndex = lines.findIndex(line => line.trim() === 'Commands:');
  if (startIndex === -1) {
    throw new Error('Commands section not found in help output');
  }

  const commands = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      break;
    }
    if (line.trim().startsWith('Options:')) {
      break;
    }

    const match = line.match(/^\s*([^\s].*?)\s{2,}(.*)$/);
    if (!match) {
      continue;
    }
    const rawCommand = match[1].replace(/\[options\]/g, '').replace(/\s+/g, ' ').trim();
    const description = match[2].trim();
    commands.push({ command: `support ${rawCommand}`.trim(), description });
  }

  return commands;
}

function renderTable(commands) {
  const rows = [
    '| Command | Description |',
    '| --- | --- |',
    ...commands.map(cmd => `| \`${cmd.command}\` | ${cmd.description} |`),
  ];
  return rows.join('\n');
}

function updateFile(filePath, table) {
  const content = readFileSync(filePath, 'utf-8');
  const startIndex = content.indexOf(HELP_MARKER_START);
  const endIndex = content.indexOf(HELP_MARKER_END);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Markers not found in ${filePath}`);
  }

  const updated = [
    content.slice(0, startIndex + HELP_MARKER_START.length),
    '',
    table,
    content.slice(endIndex),
  ].join('\n');

  writeFileSync(filePath, updated, 'utf-8');
}

const helpOutput = getHelpOutput();
const commands = parseCommands(helpOutput);
const table = renderTable(commands);

updateFile(resolve('README.md'), table);
updateFile(resolve('docs/cli.md'), table);

console.log('CLI docs updated.');
