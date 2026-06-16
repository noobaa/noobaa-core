/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sinon = require('sinon');
const { EventEmitter } = require('events');

const CORE_INIT_PATH = path.resolve(__dirname, '../../../cmd/core_init.js');
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const REPO_PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');
const REPO_INIT_SCRIPT = path.join(REPO_ROOT, 'src/deploy/NVA_build/noobaa_init.sh');
const NODE_BIN = '/usr/local/bin/node';

function load_core_init_fresh() {
    const module_path = require.resolve('../../../cmd/core_init');
    delete require.cache[module_path];
    const os_utils_path = require.resolve('../../../util/os_utils');
    if (!require.cache[os_utils_path]) {
        require.cache[os_utils_path] = {
            id: os_utils_path,
            filename: os_utils_path,
            loaded: true,
            exports: { spawn: async () => undefined },
        };
    }
    return require('../../../cmd/core_init');
}

function stub_os_utils_spawn(sandbox, { upgrade_rc = 0, upgrade_error, on_spawn } = {}) {
    const os_utils_path = require.resolve('../../../util/os_utils');
    delete require.cache[os_utils_path];
    const calls = [];
    const spawn_stub = sandbox.stub().callsFake(async (cmd, args) => {
        calls.push({ cmd, args });
        if (on_spawn) {
            on_spawn(cmd, args);
        }
        if (cmd === NODE_BIN && args[0] === 'src/upgrade/upgrade_manager.js') {
            if (upgrade_error) {
                throw upgrade_error;
            }
            if (upgrade_rc !== 0) {
                throw new Error(`spawn "${cmd} ${args.join(' ')}" exit with error code ${upgrade_rc}`);
            }
        }
    });
    require.cache[os_utils_path] = {
        id: os_utils_path,
        filename: os_utils_path,
        loaded: true,
        exports: { spawn: spawn_stub },
    };
    return calls;
}

function stub_supervisord_spawn(sandbox, { exit_code = 0 } = {}) {
    const cp = require('child_process');
    const calls = [];
    sandbox.stub(cp, 'spawn').callsFake((cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        const child = new EventEmitter();
        child.kill = sandbox.stub().callsFake(() => {
            child.killed = true;
            return true;
        });
        child.killed = false;
        process.nextTick(() => child.emit('close', exit_code, null));
        return child;
    });
    return calls;
}

function stub_supervisord_access(sandbox) {
    sandbox.stub(fs.promises, 'access').resolves();
}

function stub_supervisord_not_executable(sandbox) {
    /** @type {NodeJS.ErrnoException} */
    const err = new Error('not executable');
    err.code = 'ENOENT';
    sandbox.stub(fs.promises, 'access').rejects(err);
}

mocha.describe('core_init', function() {

    mocha.describe('unit', function() {

        mocha.it('read_package_version reads version from package.json', function() {
            const { read_package_version } = load_core_init_fresh();
            const expected = JSON.parse(fs.readFileSync(REPO_PACKAGE_JSON, 'utf8')).version;
            assert.strictEqual(read_package_version(REPO_PACKAGE_JSON), expected);
        });

        mocha.it('read_package_version throws when version line is missing', function() {
            const { read_package_version } = load_core_init_fresh();
            const tmp = path.join(os.tmpdir(), `core_init_pkg_${process.pid}.json`);
            fs.writeFileSync(tmp, '{ "name": "x" }\n');
            try {
                assert.throws(
                    () => read_package_version(tmp),
                    /version not found/
                );
            } finally {
                fs.unlinkSync(tmp);
            }
        });

        mocha.it('run_server_upgrade throws when upgrade_manager exits non-zero', async function() {
            const sandbox = sinon.createSandbox();
            stub_os_utils_spawn(sandbox, { upgrade_rc: 42 });

            try {
                const { run_server_upgrade } = load_core_init_fresh();
                await assert.rejects(
                    () => run_server_upgrade(),
                    /exit with error code 42/
                );
            } finally {
                sandbox.restore();
                delete require.cache[require.resolve('../../../cmd/core_init')];
                delete require.cache[require.resolve('../../../util/os_utils')];
            }
        });

        mocha.it('run_server_upgrade throws spawn error when node fails to start', async function() {
            const sandbox = sinon.createSandbox();
            const spawn_err = new Error('spawn /usr/local/bin/node ENOENT');
            stub_os_utils_spawn(sandbox, { upgrade_error: spawn_err });

            try {
                const { run_server_upgrade } = load_core_init_fresh();
                await assert.rejects(() => run_server_upgrade(), err => err === spawn_err);
            } finally {
                sandbox.restore();
                delete require.cache[require.resolve('../../../cmd/core_init')];
                delete require.cache[require.resolve('../../../util/os_utils')];
            }
        });

    });

    mocha.describe('repo layout parity', function() {

        mocha.it('core_init.js has executable shebang for direct invocation', function() {
            const first_line = fs.readFileSync(CORE_INIT_PATH, 'utf8').split('\n')[0];
            assert.strictEqual(first_line, '#!/usr/bin/env node');
        });

        mocha.it('noobaa_init.sh exists for endpoint and agent pods', function() {
            assert.ok(fs.existsSync(REPO_INIT_SCRIPT));
            fs.accessSync(REPO_INIT_SCRIPT, fs.constants.R_OK);
        });

        mocha.it('Dockerfile CMD runs core_init.js', function() {
            const dockerfile = fs.readFileSync(
                path.join(REPO_ROOT, 'src/deploy/NVA_build/NooBaa.Dockerfile'),
                'utf8'
            );
            assert.match(dockerfile, /CMD \["\/usr\/local\/bin\/node", "\/root\/node_modules\/noobaa-core\/src\/cmd\/core_init\.js"\]/);
        });

        mocha.it('setup_platform.sh installs supervisord at /usr/bin/supervisord_orig', function() {
            const setup_platform = fs.readFileSync(
                path.join(REPO_ROOT, 'src/deploy/NVA_build/setup_platform.sh'),
                'utf8'
            );
            assert.match(setup_platform, /\/usr\/bin\/supervisord_orig/);
            assert.doesNotMatch(setup_platform, /mv\s+"?\$\{bin_supervisord\}"?\s+\/usr\/bin\/supervisord(?!_orig)\b/);
            assert.match(setup_platform, /logfile=\/var\/log\/supervisor\/supervisord\.log/);
            assert.match(setup_platform, /childlogdir=\/var\/log\/supervisor\//);
            assert.doesNotMatch(setup_platform, /logfile=\/log\/supervisor/);
        });
    });

    mocha.describe('start flow with mocked subprocess', function() {
        let sandbox;

        mocha.beforeEach(function() {
            sandbox = sinon.createSandbox();
        });

        mocha.afterEach(function() {
            sandbox.restore();
            delete require.cache[require.resolve('../../../cmd/core_init')];
            delete require.cache[require.resolve('../../../util/os_utils')];
        });

        mocha.it('start runs upgrade_manager then supervisord with expected flags', async function() {
            const upgrade_calls = stub_os_utils_spawn(sandbox);
            const supervisord_calls = stub_supervisord_spawn(sandbox);
            stub_supervisord_access(sandbox);

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                const core_init = load_core_init_fresh();
                assert.strictEqual(await core_init.start(), 0);
                assert.ok(
                    upgrade_calls.some(c => c.cmd === NODE_BIN && c.args[0] === 'src/upgrade/upgrade_manager.js'),
                    'expected upgrade_manager to run'
                );
                assert.ok(
                    supervisord_calls.some(c => c.cmd === '/bin/sh' && c.args[1]?.includes('/usr/bin/supervisord_orig')),
                    'expected supervisord shell command'
                );
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });

        mocha.it('start throws on upgrade failure and never reaches supervisord', async function() {
            stub_os_utils_spawn(sandbox, { upgrade_rc: 42 });
            const supervisord_calls = stub_supervisord_spawn(sandbox);

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                const core_init = load_core_init_fresh();
                await assert.rejects(
                    () => core_init.start(),
                    /exit with error code 42/
                );
                assert.strictEqual(
                    supervisord_calls.some(c => c.cmd === '/bin/sh' && c.args[1]?.includes('/usr/bin/supervisord_orig')),
                    false
                );
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });

        mocha.it('start throws when supervisord is not executable', async function() {
            stub_os_utils_spawn(sandbox);
            stub_supervisord_not_executable(sandbox);

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                const core_init = load_core_init_fresh();
                await assert.rejects(
                    () => core_init.start(),
                    /is not executable/
                );
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });

        mocha.it('start returns supervisord exit code on non-zero exit', async function() {
            stub_os_utils_spawn(sandbox);
            stub_supervisord_spawn(sandbox, { exit_code: 42 });
            stub_supervisord_access(sandbox);

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                const core_init = load_core_init_fresh();
                assert.strictEqual(await core_init.start(), 42);
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });
    });

    mocha.describe('core lease', function() {
        const LEASE_UTILS_PATH = require.resolve('../../../util/core_lease_utils');

        let sandbox;

        mocha.beforeEach(function() {
            sandbox = sinon.createSandbox();
        });

        mocha.afterEach(function() {
            sandbox.restore();
            delete require.cache[require.resolve('../../../cmd/core_init')];
            delete require.cache[LEASE_UTILS_PATH];
        });

        function load_core_init_with_lease_stubs(lease_stubs = {}) {
            delete require.cache[require.resolve('../../../cmd/core_init')];
            delete require.cache[LEASE_UTILS_PATH];
            const lease_utils = require('../../../util/core_lease_utils');
            sandbox.stub(lease_utils, 'is_core_lease_enabled').returns(lease_stubs.enabled ?? false);
            if (lease_stubs.enabled) {
                const mock_client = Object.assign(new EventEmitter(), {
                    acquire_lease: sandbox.stub().resolves(),
                    renew_lease_loop: sandbox.stub().resolves(),
                    stop_renew_loop: sandbox.stub().resolves(),
                    release_lease: sandbox.stub().resolves(),
                    ...lease_stubs.client,
                });
                sandbox.stub(lease_utils, 'create_client_from_env').returns(mock_client);
                return { core_init: require('../../../cmd/core_init'), mock_client };
            }
            return { core_init: require('../../../cmd/core_init'), mock_client: null };
        }

        mocha.it('start acquires lease before upgrade when HA is enabled', async function() {
            const order = [];
            stub_os_utils_spawn(sandbox, {
                upgrade_rc: 0,
                on_spawn: (cmd, args) => {
                    if (cmd === NODE_BIN && args[0] === 'src/upgrade/upgrade_manager.js') {
                        order.push('upgrade');
                    }
                },
            });
            stub_supervisord_spawn(sandbox);
            stub_supervisord_access(sandbox);

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                const { core_init, mock_client } = load_core_init_with_lease_stubs({ enabled: true });
                mock_client.acquire_lease.callsFake(async () => {
                    order.push('acquire');
                });

                assert.strictEqual(await core_init.start(), 0);
                assert.ok(order.indexOf('acquire') < order.indexOf('upgrade'),
                    `expected acquire before upgrade, got ${order.join(',')}`);
                assert.strictEqual(mock_client.acquire_lease.calledOnce, true);
                assert.strictEqual(mock_client.stop_renew_loop.calledOnce, true);
                assert.strictEqual(mock_client.release_lease.calledOnce, true);
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });

        mocha.it('release_lease is called before start() returns when step_down fires during run_supervisord', async function() {
            // This tests the _step_down_promise race fix:
            // Without `await _step_down_promise` in start()'s finally block, start() would return
            // before _do_step_down() resumes from kill_supervisord() to call release_lease(),
            // because run_supervisord()'s close listener is registered before kill_supervisord()'s.
            const exit_stub = sandbox.stub(process, 'exit');

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                stub_os_utils_spawn(sandbox);
                stub_supervisord_access(sandbox);

                // Supervisord that stays alive until SIGKILL, mimicking a real process.
                const cp = require('child_process');
                sandbox.stub(cp, 'spawn').callsFake(() => {
                    const child = new EventEmitter();
                    child.kill = sinon.stub().callsFake(signal => {
                        if (signal === 'SIGKILL') {
                            process.nextTick(() => child.emit('close', 0, null));
                        }
                    });
                    child.killed = false;
                    return child;
                });

                const { core_init, mock_client } = load_core_init_with_lease_stubs({ enabled: true });

                // Trigger step_down after supervisord is running (i.e. while start() is awaiting it).
                mock_client.renew_lease_loop.callsFake(async () => {
                    await new Promise(resolve => setImmediate(resolve));
                    mock_client.emit('lost_leadership');
                });

                await core_init.start();

                // With the fix, start()'s finally block awaits _step_down_promise, so
                // release_lease must already be done by the time start() resolves.
                assert.strictEqual(mock_client.release_lease.calledOnce, true,
                    'release_lease must complete before start() returns');
                assert.strictEqual(exit_stub.calledOnce, true);
                assert.strictEqual(exit_stub.firstCall.args[0], 0);
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });

        mocha.it('start_core_lease_renewal calls step_down_from_lease when renew reports lost leadership', async function() {
            const exit_stub = sandbox.stub(process, 'exit');
            const { core_init, mock_client } = load_core_init_with_lease_stubs({ enabled: true });
            mock_client.renew_lease_loop.callsFake(async () => {
                mock_client.emit('lost_leadership');
            });

            core_init.start_core_lease_renewal(mock_client);
            await new Promise(resolve => setImmediate(resolve));

            assert.strictEqual(exit_stub.calledOnce, true);
            assert.strictEqual(exit_stub.firstCall.args[0], 0);
            assert.strictEqual(mock_client.release_lease.calledOnce, true);
        });
    });
});
