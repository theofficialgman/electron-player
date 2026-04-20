const { readFileSync, writeFileSync } = require('fs');

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));
const snapcraft = readFileSync('./snap/snapcraft.yaml', 'utf-8');
const updated = snapcraft.replace(/^version: .*/m, `version: '${version}'`);
writeFileSync('./snap/snapcraft.yaml', updated);
console.log(`snapcraft.yaml version set to ${version}`);
