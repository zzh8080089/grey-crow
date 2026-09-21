#!/usr/bin/env node
'use strict';

// Developer build only. Players receive the resulting native runtime, never a
// compiler or Python environment. This does not package or sign the game.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SHERPA_VERSION = '1.13.8';
const SHERPA_URL = `https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v${SHERPA_VERSION}.tar.gz`;
const SHERPA_SHA256 = 'b0374cc56dbc186d442ae73d5de743bb092470b640c4c50ce7b029044c0c4fa8';
const desktop = path.resolve(__dirname, '..');
const native = path.join(desktop, 'speech-input', 'native');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 30 * 60 * 1000, ...options });
  if (result.error || result.status !== 0) throw new Error(`Build command failed: ${path.basename(command)} (${result.error?.code || result.status})`);
  return result;
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function download(url, file, expected) {
  if (fs.existsSync(file)) {
    if (hash(file) !== expected) throw new Error(`Cached archive checksum mismatch: ${path.basename(file)}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.partial`;
  try {
    run('curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--retry', '2', '--max-time', '600', url, '--output', temporary]);
    if (hash(temporary) !== expected) throw new Error(`Downloaded archive checksum mismatch: ${path.basename(file)}`);
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
function copyNotices(source, destination, at = '') {
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['.git', 'node_modules', 'test', 'tests', 'bench', 'benchmark'].includes(entry.name)) continue;
    const relative = path.join(at, entry.name);
    const src = path.join(source, entry.name);
    if (entry.isDirectory()) copyNotices(src, destination, relative);
    else if (/(^|[/\\])(licenses?|copying|notice|thirdpartynotices)([.\-_]|[/\\]|$)/i.test(relative)) {
      const dest = path.join(destination, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}
function files(root, at = '') {
  return fs.readdirSync(path.join(root, at), { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(at, entry.name);
    return entry.isDirectory() ? files(root, relative) : [{ path: relative.split(path.sep).join('/'), bytes: fs.statSync(path.join(root, relative)).size, sha256: hash(path.join(root, relative)) }];
  });
}
function dependencyProvenance(dependencies) {
  const pinned = JSON.parse(fs.readFileSync(path.join(native, 'dependency-sources.json'), 'utf8'));
  return fs.readdirSync(dependencies, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.endsWith('-subbuild')).map(entry => {
    const name = entry.name.slice(0, -9);
    const info = path.join(dependencies, entry.name, `${name}-populate-prefix`, 'src', `${name}-populate-stamp`, `${name}-populate-urlinfo.txt`);
    const value = fs.readFileSync(info, 'utf8');
    const urls = value.match(/^url\(s\)=(.*)$/m)?.[1];
    const checksum = value.match(/^hash=SHA256=([a-f0-9]{64})$/m)?.[1];
    if (!urls || !checksum) throw new Error(`Missing fixed dependency provenance: ${name}`);
    const recordedUrls = urls.split(';');
    const fallback = pinned.find(entry => entry.name === name && entry.archiveSha256 === checksum);
    const publicUrls = recordedUrls.filter(url => /^https:\/\//.test(url));
    // CMake may select a user's Downloads cache. Do not expose its absolute
    // personal path in the player-facing manifest.
    if (!publicUrls.length && !fallback) throw new Error(`Dependency source mapping requires review: ${name}`);
    return { name, sourceUrls: publicUrls.length ? publicUrls : fallback.sourceUrls,
      archiveSha256: checksum, localCacheUsed: publicUrls.length !== recordedUrls.length };
  });
}
function provideEigenSources({ cmake, work, output, executable }) {
  const sources = path.join(output, 'sources');
  fs.mkdirSync(sources, { recursive: true });
  // Copy the immutable upstream archive instead of repacking files with the
  // developer's uid/user name and a fresh gzip timestamp.
  const eigenArchive = path.join(work, 'eigen-5.0.1.tar.gz');
  download('https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz', eigenArchive,
    'e9c326dc8c05cd1e044c71f30f1b2e34a6161a3b6ecf445d56b53ff1669e3dec');
  fs.copyFileSync(eigenArchive, path.join(sources, 'eigen-5.0.1.tar.gz'));

  const supplied = path.join(native, 'onnxruntime-eigen');
  const metadata = JSON.parse(fs.readFileSync(path.join(supplied, 'SOURCE.json'), 'utf8'));
  const buildInfo = fs.readFileSync(executable).toString('latin1').match(/ORT Build Info: [^\0\r\n]+/)?.[0];
  if (buildInfo !== metadata.onnxruntime.embeddedBuildInfo) throw new Error('Native ONNX Runtime build metadata changed; audit its corresponding Eigen source before distribution');
  for (const file of metadata.files) {
    if (hash(path.join(supplied, file.path)) !== file.sha256) throw new Error(`Corresponding source checksum mismatch: ${file.path}`);
  }
  const archive = path.join(work, `eigen-ort-${metadata.eigen.commit}.zip`);
  download(metadata.eigen.sourceUrl, archive, metadata.eigen.archiveSha256);
  if (crypto.createHash('sha1').update(fs.readFileSync(archive)).digest('hex') !== metadata.eigen.archiveSha1)
    throw new Error('Eigen archive differs from the actual ONNX Runtime dependency hash');
  const destination = path.join(sources, `eigen-onnxruntime-${metadata.eigen.commit}`);
  fs.cpSync(supplied, destination, { recursive: true });
  fs.copyFileSync(archive, path.join(destination, 'upstream.zip'));
  const extracted = path.join(work, 'ort-eigen-notices');
  fs.mkdirSync(extracted, { recursive: true });
  run(cmake, ['-E', 'tar', 'xf', archive], { cwd: extracted });
  copyNotices(path.join(extracted, `eigen-${metadata.eigen.commit}`), path.join(output, 'licenses', 'eigen-onnxruntime'));
  return { actualEmbeddedBuildInfo: buildInfo, sourceCommit: metadata.onnxruntime.sourceCommit,
    eigenCommit: metadata.eigen.commit, sourceBundle: `sources/eigen-onnxruntime-${metadata.eigen.commit}`,
    evidence: 'Pinned release archive digest plus binary build metadata mapped to fixed upstream dependencies and patches; not an independent byte-for-byte ONNX Runtime rebuild.' };
}
function publishRuntime(destination, populate) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = fs.mkdtempSync(`${destination}.staging-`);
  const previous = `${destination}.previous-${crypto.randomUUID()}`;
  let backedUp = false, published = false;
  try {
    // A new complete tree avoids carrying stale Python/TTS libraries or samples
    // from a developer's previous runtime preparation into a player package.
    populate(staging);
    if (fs.existsSync(destination)) { fs.renameSync(destination, previous); backedUp = true; }
    try { fs.renameSync(staging, destination); published = true; }
    catch (error) { if (backedUp) fs.renameSync(previous, destination); throw error; }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (published && backedUp) {
      try { fs.rmSync(previous, { recursive: true, force: true }); }
      catch { console.warn('Previous development runtime is still in use; remove its .previous directory after closing it.'); }
    }
  }
}
function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    if (!['--work-dir', '--source-archive', '--cmake', '--jobs'].includes(flag) || !process.argv[i + 1] || options[flag]) throw new Error('Usage: node prepare-speech-input-runtime.js [--work-dir DIR] [--source-archive FILE] [--cmake FILE] [--jobs 1..16]');
    options[flag] = process.argv[i + 1];
  }
  const target = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target)) throw new Error(`Unsupported build host: ${target}`);
  const cmake = options['--cmake'] || process.env.CMAKE || 'cmake';
  const jobs = Number(options['--jobs'] || Math.min(4, os.availableParallelism?.() || os.cpus().length));
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) throw new Error('Invalid --jobs');
  const work = path.resolve(options['--work-dir'] || path.join(desktop, 'speech-input', '.runtime-build', target));
  const build = path.join(work, 'build');
  const source = path.join(work, `sherpa-onnx-${SHERPA_VERSION}`);
  const archive = path.resolve(options['--source-archive'] || path.join(work, `sherpa-onnx-${SHERPA_VERSION}.tar.gz`));
  const destination = path.join(desktop, 'speech-input', '.runtime', target);
  run(cmake, ['--version']);
  fs.mkdirSync(work, { recursive: true });
  download(SHERPA_URL, archive, SHERPA_SHA256);
  if (!fs.existsSync(path.join(source, 'CMakeLists.txt'))) run(cmake, ['-E', 'tar', 'xzf', archive], { cwd: work });
  const configure = ['-S', native, '-B', build, `-DSHERPA_ONNX_SOURCE_DIR=${source}`, '-DCMAKE_BUILD_TYPE=Release'];
  if (process.platform === 'darwin') configure.push('-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0');
  if (process.platform === 'win32') configure.push('-A', 'x64');
  run(cmake, configure);
  run(cmake, ['--build', build, '--config', 'Release', '--target', 'speech-input-cli', '--parallel', String(jobs)]);
  const name = process.platform === 'win32' ? 'speech-input-cli.exe' : 'speech-input-cli';
  const executable = path.join(build, process.platform === 'win32' ? 'Release' : '', name);
  if (!fs.existsSync(executable)) throw new Error('Native build did not produce CLI');
  publishRuntime(destination, (output) => {
  fs.mkdirSync(path.join(output, 'bin'), { recursive: true });
  fs.copyFileSync(executable, path.join(output, 'bin', name));
  if (process.platform !== 'win32') fs.chmodSync(path.join(output, 'bin', name), 0o755);
  const notices = path.join(output, 'licenses');
  // This directory is derived exclusively from this script, not player data.
  fs.rmSync(notices, { recursive: true, force: true });
  fs.cpSync(path.join(native, 'licenses'), notices, { recursive: true });
  copyNotices(source, path.join(notices, 'sherpa-onnx'));
  const dependencies = path.join(build, '_deps');
  for (const entry of fs.readdirSync(dependencies, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('-src')) continue;
    if (entry.name === 'json-src') {
      // nlohmann's GPL imapdl test helper and BSD amalgamation tool are not
      // compiled into the header-only JSON library. Preserve its actual MIT
      // license plus upstream third-party attribution and file-level mapping.
      const target = path.join(notices, 'json');
      fs.mkdirSync(target, { recursive: true });
      for (const [from, to] of [['LICENSE.MIT', 'LICENSE.MIT'], ['docs/mkdocs/docs/home/license.md', 'ATTRIBUTION.md'], ['.reuse/dep5', 'source-license-map.txt']])
        fs.copyFileSync(path.join(dependencies, entry.name, from), path.join(target, to));
    } else copyNotices(path.join(dependencies, entry.name), path.join(notices, entry.name.slice(0, -4)));
  }
  const correspondingSource = provideEigenSources({ cmake, work, output, executable });
  const snapshot = {
    schemaVersion: 1, target, builtAt: new Date().toISOString(), protocolVersion: 1,
    engine: { name: 'sherpa-onnx', version: SHERPA_VERSION, sourceUrl: SHERPA_URL, sourceArchiveSha256: SHERPA_SHA256 },
    dependencies: dependencyProvenance(dependencies),
    onnxruntimeCorrespondingSource: correspondingSource,
    nativeSources: ['CMakeLists.txt', 'audio-input.h', 'speech-input-cli.cc'].map(name => ({ path: name, sha256: hash(path.join(native, name)) })),
    options: { static: true, tts: false, speakerDiarization: false, python: false, portaudio: false, websocket: false, provider: 'cpu', threads: 4 },
    modelBundled: false, minimumMacOS: process.platform === 'darwin' ? '13.0 (linked dependencies must also be inspected)' : null,
    validation: { nativeVersion: JSON.parse(run(path.join(output, 'bin', name), ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).stdout), windowsRealDeviceTested: false },
    files: files(output).filter(file => file.path !== 'runtime-manifest.json')
  };
  fs.writeFileSync(path.join(output, 'runtime-manifest.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  });
  console.log(`Speech input runtime ready: ${destination}`);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { run, hash, download, files, publishRuntime };
