import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

export const sqlValue = (value) => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

/** Runs real PostgreSQL in an isolated, disposable local cluster. Never accepts a remote URL. */
export async function createTestDatabase() {
  const binaryDirectory = process.env.PG_BIN
    ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/17/bin' : '');
  const binary = (name) => binaryDirectory
    ? join(binaryDirectory, `${name}${process.platform === 'win32' ? '.exe' : ''}`)
    : name;
  const suppliedDirectory = process.env.ASIENTO_DB_TEST_DIR;
  const directory = suppliedDirectory
    ? resolve(suppliedDirectory)
    : await mkdtemp(join(tmpdir(), 'asientolibre-db-test-'));

  // Restrict both reuse and recursive cleanup to the exact generated temporary directory.
  assert.equal(dirname(directory).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.match(basename(directory), /^asientolibre-db-(?:test|qa)-[a-zA-Z0-9-]+$/);
  const dataDirectory = join(directory, 'data');
  const port = suppliedDirectory ? Number(process.env.ASIENTO_DB_TEST_PORT ?? 55432) : await availablePort();
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
  let started = false;
  const sessions = new Set();

  async function command(name, args) {
    return execute(binary(name), args, { windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  }

  async function controlPostgres(args) {
    const child = spawn(binary('pg_ctl'), args, { windowsHide: true, stdio: 'ignore' });
    const [code] = await once(child, 'close');
    if (code !== 0) throw new Error(`pg_ctl exited with code ${code}.`);
  }

  const psqlArgs = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres'];

  async function sql(statement) {
    const { stdout } = await command('psql', [...psqlArgs, '-c', statement]);
    return stdout.trim();
  }

  async function file(path) {
    await command('psql', [...psqlArgs, '-f', path]);
  }

  async function json(statement) {
    return JSON.parse(await sql(statement));
  }

  async function fails(statement, expected) {
    let caught;
    try { await sql(statement); } catch (error) { caught = error; }
    assert(caught, 'The SQL statement should have failed.');
    assert.match(caught.stderr ?? caught.message, expected);
  }

  function connection(name) {
    const child = spawn(binary('psql'), psqlArgs, {
      windowsHide: true,
      env: { ...process.env, PGAPPNAME: name },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    sessions.add(child);
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk; });
    // A failing psql statement can close stdin before the caller observes exit.
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') errors += error.message;
    });
    const completed = new Promise((done, reject) => {
      child.once('error', reject);
      child.once('close', (code) => { sessions.delete(child); done({ code, output, errors }); });
    });
    return {
      send(statement) { child.stdin.write(`${statement}\n`); },
      async waitFor(marker) {
        const end = Date.now() + 10000;
        while (!output.includes(marker)) {
          if (child.exitCode !== null || Date.now() > end) {
            throw new Error(`PostgreSQL session did not produce ${marker}: ${errors}`);
          }
          await pause(20);
        }
      },
      async end(statement = '') {
        if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end(`${statement}\n`);
        return completed;
      },
    };
  }

  async function waitForLock(name) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name = ${sqlValue(name)} AND wait_event_type = 'Lock';`) === '1') return;
      await pause(30);
    }
    throw new Error(`Session ${name} did not wait for a real PostgreSQL lock.`);
  }

  async function close() {
    for (const child of sessions) child.kill();
    if (!suppliedDirectory && started) {
      // Do not let a Windows pg_ctl wait inherit handles from the Node test process.
      await controlPostgres(['-D', dataDirectory, '-m', 'immediate', '-W', 'stop']);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        try { await stat(join(dataDirectory, 'postmaster.pid')); await pause(50); }
        catch { break; }
      }
    }
    if (!suppliedDirectory) {
      assert.equal(dirname(resolve(directory)).toLowerCase(), resolve(tmpdir()).toLowerCase());
      assert.match(basename(directory), /^asientolibre-db-test-[a-zA-Z0-9-]+$/);
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }

  try {
    if (suppliedDirectory) {
      await stat(join(dataDirectory, 'PG_VERSION'));
      await controlPostgres(['-D', dataDirectory, 'status']);
      // Ensure the requested port belongs to this exact temporary cluster before writing anything.
      const actualDirectory = (await sql('SHOW data_directory;')).replaceAll('\\', '/');
      assert.equal(actualDirectory.toLowerCase(), dataDirectory.replaceAll('\\', '/').toLowerCase());
    } else {
      await command('initdb', ['-D', dataDirectory, '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C']);
      await controlPostgres(['-D', dataDirectory, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-W', 'start']);
      started = true;
      const deadline = Date.now() + 10000;
      let ready = false;
      while (Date.now() < deadline) {
        try { await sql('SELECT 1;'); ready = true; break; }
        catch { await pause(50); }
      }
      if (!ready) throw new Error('PostgreSQL did not become ready.');
    }
  } catch (error) {
    await close();
    throw new Error('Could not start isolated PostgreSQL tests. Install PostgreSQL and set PG_BIN to its bin directory.', { cause: error });
  }

  return { sql, file, json, fails, connection, waitForLock, close, directory, port, readFile };
}
