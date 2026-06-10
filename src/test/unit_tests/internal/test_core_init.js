/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sinon = require('sinon');

const CORE_INIT_PATH = path.resolve(__dirname, '../../../cmd/core_init.js');
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const REPO_PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');
const REPO_INIT_SCRIPT = path.join(REPO_ROOT, 'src/deploy/NVA_build/noobaa_init.sh');
const NODE_BIN = '/usr/local/bin/node';

function load_core_init_fresh() {
    const module_path = require.resolve('../../../cmd/core_init');
    delete require.cache[module_path];
    return require('../../../cmd/core_init');
}

function stub_spawn_for_start(sandbox, { upgrade_rc = 0 } = {}) {
    const cp = require('child_process');
    const calls = [];
    sandbox.stub(cp, 'spawnSync').callsFake((cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        if (cmd === NODE_BIN && args[0] === 'src/upgrade/upgrade_manager.js') {
            return { status: upgrade_rc, stdout: '', stderr: '' };
        }
        if (cmd === '/bin/sh' && args[0] === '-c' && args[1]?.includes('/usr/bin/supervisord')) {
            return { status: 0, stdout: '', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
    });
    return calls;
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

        mocha.it('run_server_upgrade throws when upgrade_manager exits non-zero', function() {
            const sandbox = sinon.createSandbox();
            stub_spawn_for_start(sandbox, { upgrade_rc: 42 });

            try {
                const { run_server_upgrade } = load_core_init_fresh();
                assert.throws(
                    () => run_server_upgrade(),
                    /upgrade_manager failed with exit code 42/
                );
            } finally {
                sandbox.restore();
                delete require.cache[require.resolve('../../../cmd/core_init')];
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

        mocha.it('Dockerfile CMD runs core_init.js and does not reference supervisord.orig', function() {
            const dockerfile = fs.readFileSync(
                path.join(REPO_ROOT, 'src/deploy/NVA_build/NooBaa.Dockerfile'),
                'utf8'
            );
            assert.match(dockerfile, /CMD \["\/usr\/local\/bin\/node", "\/root\/node_modules\/noobaa-core\/src\/cmd\/core_init\.js"\]/);
            assert.doesNotMatch(dockerfile, /supervisord\.orig/);
        });

        mocha.it('setup_platform.sh configures supervisord logs under /var/log/supervisor', function() {
            const setup_platform = fs.readFileSync(
                path.join(REPO_ROOT, 'src/deploy/NVA_build/setup_platform.sh'),
                'utf8'
            );
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
        });

        mocha.it('start runs upgrade_manager then supervisord with expected flags', function() {
            const calls = stub_spawn_for_start(sandbox);
            sandbox.stub(fs, 'accessSync').callsFake(() => undefined);

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                const core_init = load_core_init_fresh();
                assert.strictEqual(core_init.start(), 0);
                assert.ok(
                    calls.some(c => c.cmd === NODE_BIN && c.args[0] === 'src/upgrade/upgrade_manager.js'),
                    'expected upgrade_manager to run'
                );
                assert.ok(
                    calls.some(c => c.cmd === '/bin/sh' && c.args[1]?.includes('/usr/bin/supervisord')),
                    'expected supervisord shell command'
                );
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });

        mocha.it('start throws on upgrade failure and never reaches supervisord', function() {
            const calls = stub_spawn_for_start(sandbox, { upgrade_rc: 42 });

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                const core_init = load_core_init_fresh();
                assert.throws(
                    () => core_init.start(),
                    /upgrade_manager failed with exit code 42/
                );
                assert.strictEqual(
                    calls.some(c => c.cmd === '/bin/sh' && c.args[1]?.includes('/usr/bin/supervisord')),
                    false
                );
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });

        mocha.it('start throws when supervisord is not executable', function() {
            stub_spawn_for_start(sandbox);
            sandbox.stub(fs, 'accessSync').callsFake(() => {
                /** @type {NodeJS.ErrnoException} */
                const err = new Error('not executable');
                err.code = 'ENOENT';
                throw err;
            });

            const prev_pkg = process.env.CORE_INIT_TEST_PACKAGE_JSON;
            process.env.CORE_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;

            try {
                const core_init = load_core_init_fresh();
                assert.throws(
                    () => core_init.start(),
                    /is not executable/
                );
            } finally {
                if (prev_pkg === undefined) delete process.env.CORE_INIT_TEST_PACKAGE_JSON;
                else process.env.CORE_INIT_TEST_PACKAGE_JSON = prev_pkg;
            }
        });
    });
});
