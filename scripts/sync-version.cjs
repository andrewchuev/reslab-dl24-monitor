#!/usr/bin/env node
// Runs as npm's "version" lifecycle script (part of `npm version <bump>`), after
// package.json's version has been updated but before npm commits/tags it. Keeps
// src-tauri/Cargo.toml's package version in sync so a single `npm version` bump
// is the one manual step needed to release a new version; tauri.conf.json needs
// no update since its "version" field already points at package.json.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const version = pkg.version;

const cargoTomlPath = path.join(__dirname, '..', 'src-tauri', 'Cargo.toml');
const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
const versionLine = /^version = ".*"\r?$/m;

if (!versionLine.test(cargoToml)) {
  console.error(`sync-version: did not find a "version = ..." line to update in ${cargoTomlPath}`);
  process.exit(1);
}

fs.writeFileSync(cargoTomlPath, cargoToml.replace(versionLine, `version = "${version}"`));
execSync('cargo update --workspace --offline', { cwd: path.join(__dirname, '..', 'src-tauri'), stdio: 'ignore' });
execSync(`git add "${cargoTomlPath}" "${path.join(__dirname, '..', 'src-tauri', 'Cargo.lock')}"`);

console.log(`sync-version: src-tauri/Cargo.toml -> ${version}`);
