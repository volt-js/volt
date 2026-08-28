/**
 * Real-browser timings for `create` and `select row`, taken twice.
 *
 * The roadmap's `select row` item is blocked on a number, not on an opinion:
 * one-effect-per-row codegen exists behind `groupRowBindings`, it saves about
 * 2.3 kB a row, and it makes invalidation coarser — so it should help `create`
 * and hurt `select row`. Which of those wins decides the default, and happy-dom
 * cannot say, because its DOM is JavaScript and dominates both operations.
 *
 * So: build the same page twice, once with the flag and once without, and run
 * both under one real Chrome in one process. Everything that would otherwise
 * differ between two runs — machine load, browser version, GC state, who was
 * clicking — is held still by doing it that way.
 *
 *   node benchmarks/browser/run.mjs [--iterations 12] [--rows 1000]
 *
 * No dependency is added for this. Chrome is driven over the DevTools protocol
 * through Node's own `WebSocket`, and the built page is served by a static
 * handler in this file.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { once } from 'node:events';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(args[at + 1]);
};
const ITERATIONS = flag('iterations', 12);
const ROWS = flag('rows', 1000);
/**
 * `--profile` swaps the comparison for a sampling profile of `create` alone.
 *
 * The comparison says which of two builds is faster; it cannot say what either
 * one is spending its time on, and "close the create gap" is a question of the
 * second kind. Chrome's own sampler answers it, over the same page, driven the
 * same way.
 */
const PROFILE = args.includes('--profile');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

function serve(directory) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const file = join(directory, path === '/' ? 'index.html' : path);
    if (!file.startsWith(directory)) {
      response.writeHead(403).end();
      return;
    }
    const stream = createReadStream(file);
    // Headers on `open`, not before it: a missing file errors after the call
    // to `createReadStream` returns, and a 200 already written cannot become
    // a 404.
    stream.once('open', () => {
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      });
      stream.pipe(response);
    });
    stream.once('error', () => response.writeHead(404).end());
  });
  return server;
}

async function build(grouped) {
  const out = join(ROOT, grouped ? 'dist-grouped' : 'dist-plain');
  await rm(out, { recursive: true, force: true });
  const child = spawn(
    'pnpm',
    [
      'exec',
      'vite',
      'build',
      '--config',
      join(ROOT, 'vite.config.ts'),
      '--outDir',
      out,
      // A profile of minified code names every function `W`. The comparison
      // runs minified because that is what ships; a profile does not, because
      // the whole output of one is the names.
      ...(PROFILE ? ['--minify', 'false'] : []),
    ],
    {
      cwd: ROOT,
      env: { ...process.env, VOLT_GROUP_ROWS: grouped ? '1' : '0' },
      stdio: 'pipe',
    },
  );
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`build (grouped=${grouped}) failed:\n${log}`);
  return out;
}

/** A CDP session over one page target. */
class Session {
  #socket;
  #next = 1;
  #waiting = new Map();

  static async open(url) {
    const socket = new WebSocket(url);
    await once(socket, 'open');
    const session = new Session();
    session.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const settle = session.#waiting.get(message.id);
      if (!settle) return;
      session.#waiting.delete(message.id);
      if (message.error) settle.reject(new Error(message.error.message));
      else settle.resolve(message.result);
    });
    return session;
  }

  send(method, params = {}) {
    const id = this.#next++;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#waiting.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return result.result.value;
  }

  close() {
    this.#socket.close();
  }
}

async function chromeTarget(port) {
  // Chrome writes the port line before it is ready to answer, so this polls
  // rather than trusting the announcement.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((entry) => entry.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('chrome never answered on the debugging port');
}

/**
 * Where `create` spends its time, by function, self time first.
 *
 * Self and not total: a profile ordered by total time reports the entry point
 * at the top every time, which is true and useless. Self time is the line to
 * go and look at.
 */
async function profile(session, origin) {
  await ready(session, origin);
  // Two warm creates before the sampler starts: the first pays for the JIT
  // and the first layout, and a profile that includes them is a profile of
  // starting Chrome.
  for (let i = 0; i < 2; i++) {
    await session.evaluate(`globalThis.__bench.create(${ROWS})`);
    await session.evaluate('globalThis.__bench.clear()');
  }

  await session.send('Profiler.enable');
  // 10µs, against the 1ms default: one create is ~200ms, and a default-rate
  // profile of it is a few hundred samples spread over the whole framework.
  await session.send('Profiler.setSamplingInterval', { interval: 10 });

  const self = new Map();
  let total = 0;

  // Started and stopped around each create, with the clear outside it. A
  // single profile over the whole loop is a profile of create *and* clear —
  // and clear's `replaceContent` is large enough to come out on top of it,
  // which is a true statement about a loop nobody runs.
  for (let i = 0; i < ITERATIONS; i++) {
    await session.evaluate('globalThis.__bench.clear()');
    await session.send('Profiler.start');
    await session.evaluate(`globalThis.__bench.create(${ROWS})`);
    const { profile: cpu } = await session.send('Profiler.stop');

    const byId = new Map(cpu.nodes.map((node) => [node.id, node]));
    for (const id of cpu.samples ?? []) {
      const node = byId.get(id);
      if (!node) continue;
      const { functionName, url, lineNumber } = node.callFrame;
      const where = `${functionName || '(anonymous)'}  ${(url || '').split('/').pop()}:${lineNumber + 1}`;
      self.set(where, (self.get(where) ?? 0) + 1);
      total++;
    }
  }

  return [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 22)
    .map(([where, count]) => `${((count / total) * 100).toFixed(1).padStart(5)}%  ${where}`);
}

/** Load the page and wait for the benchmark handle to be published. */
async function ready(session, origin) {
  await session.evaluate(`new Promise((done) => {
    location.href = ${JSON.stringify(origin)};
    done(true);
  })`);
  for (let attempt = 0; attempt < 200; attempt++) {
    const up = await session.evaluate('typeof globalThis.__bench === "object"').catch(() => false);
    if (up) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the benchmark page never published its handle');
}

/** Middle value: one slow iteration is a machine hiccup, not a measurement. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function measure(session, origin) {
  await ready(session, origin);

  const creates = [];
  const selects = [];
  const vanillas = [];
  for (let i = 0; i < ITERATIONS; i++) {
    // Hand-written first and cleared straight away, so the two never share a
    // layout: whichever ran second would otherwise be charged for relaying out
    // whatever the first had left on the page.
    vanillas.push(await session.evaluate(`globalThis.__bench.vanilla(${ROWS})`));
    await session.evaluate('globalThis.__bench.clearVanilla()');
    creates.push(await session.evaluate(`globalThis.__bench.create(${ROWS})`));
    // Five selects per create, each on a different row, so the number is not
    // one sample and not the same row's cached anything.
    for (let row = 0; row < 5; row++) {
      selects.push(await session.evaluate(`globalThis.__bench.select(${row * 7 + 1})`));
    }
    await session.evaluate('globalThis.__bench.clear()');
  }
  // The first iteration is the browser warming up: JIT, first layout, first
  // paint. Dropped from both sides equally.
  const c = creates.slice(1);
  const t = selects.slice(5);
  const v = vanillas.slice(1);
  // Mean as well as median, because Chrome coarsens `performance.now` to 100µs
  // and a select of a thousand rows lands within a few ticks of that. Two
  // medians that read the same there are two numbers the clock could not
  // separate, not two operations that cost the same; averaging the samples
  // recovers the difference the quantisation hid.
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  return {
    create: median(c),
    select: median(t),
    createMean: mean(c),
    selectMean: mean(t),
    vanilla: median(v),
    vanillaMean: mean(v),
  };
}

const port = 9333 + (process.pid % 200);
const profileDirectory = join(HERE, `.chrome-${process.pid}`);
const chrome = spawn(
  '/usr/bin/google-chrome',
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let session;
const servers = [];
try {
  const plainDir = await build(false);
  const groupedDir = await build(true);

  const results = {};
  session = await Session.open(await chromeTarget(port));
  await session.send('Runtime.enable');

  if (PROFILE) {
    const server = serve(plainDir);
    server.listen(0);
    await once(server, 'listening');
    servers.push(server);
    const lines = await profile(session, `http://127.0.0.1:${server.address().port}/`);
    console.log(`\nWhere \`create ${ROWS}\` spends its time, self time first:\n`);
    for (const line of lines) console.log(line);
    console.log('');
  } else {

  for (const [name, directory] of [
    ['ungrouped', plainDir],
    ['grouped', groupedDir],
  ]) {
    const server = serve(directory);
    server.listen(0);
    await once(server, 'listening');
    servers.push(server);
    results[name] = await measure(session, `http://127.0.0.1:${server.address().port}/`);
  }

  const { ungrouped, grouped } = results;
  const ratio = (a, b) => (b === 0 ? Number.NaN : a / b);
  console.log(`\nReal Chrome, ${ROWS} rows, ${ITERATIONS} iterations, medians:\n`);
  console.log('operation      ungrouped    grouped     grouped/ungrouped');
  console.log(
    `create        ${ungrouped.create.toFixed(2).padStart(8)} ms ${grouped.create
      .toFixed(2)
      .padStart(8)} ms   ${ratio(grouped.create, ungrouped.create).toFixed(3)}`,
  );
  console.log(
    `select row    ${ungrouped.select.toFixed(2).padStart(8)} ms ${grouped.select
      .toFixed(2)
      .padStart(8)} ms   ${ratio(grouped.select, ungrouped.select).toFixed(3)}`,
  );
  console.log(
    `create (mean) ${ungrouped.createMean.toFixed(2).padStart(8)} ms ${grouped.createMean
      .toFixed(2)
      .padStart(8)} ms   ${ratio(grouped.createMean, ungrouped.createMean).toFixed(3)}`,
  );
  console.log(
    `select (mean) ${ungrouped.selectMean.toFixed(2).padStart(8)} ms ${grouped.selectMean
      .toFixed(2)
      .padStart(8)} ms   ${ratio(grouped.selectMean, ungrouped.selectMean).toFixed(3)}`,
  );
  console.log('\nBelow 1.000 is grouping winning; above 1.000 is grouping costing.\n');

  // The other comparison, and the one the `create` entry is actually about:
  // the same table built by hand, on the same page, in the same browser.
  console.log(
    `create against hand-written DOM: ${ungrouped.create.toFixed(2)} ms vs ` +
      `${ungrouped.vanilla.toFixed(2)} ms  (${ratio(ungrouped.create, ungrouped.vanilla).toFixed(3)}x), ` +
      `means ${ungrouped.createMean.toFixed(2)} vs ${ungrouped.vanillaMean.toFixed(2)} ` +
      `(${ratio(ungrouped.createMean, ungrouped.vanillaMean).toFixed(3)}x)\n`,
  );
  }
} finally {
  session?.close();
  for (const server of servers) server.close();
  chrome.kill();
  // Chrome writes to its profile as it shuts down, so removing the directory
  // the moment `kill` returns races it and fails with ENOTEMPTY.
  await once(chrome, 'exit').catch(() => {});
  await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
}
