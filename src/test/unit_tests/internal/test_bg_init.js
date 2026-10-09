/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const sinon = require('sinon');

const BG_INIT_PATH = path.resolve(__dirname, '../../../cmd/bg_init.js');
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const REPO_PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');

function load_bg_init_fresh() {
    const module_path = require.resolve('../../../cmd/bg_init');
    delete require.cache[module_path];
    return require('../../../cmd/bg_init');
}

mocha.describe('bg_init', function() {

    mocha.describe('unit', function() {

        mocha.it('read_package_version reads version from package.json', function() {
            const { read_package_version } = load_bg_init_fresh();
            const expected = JSON.parse(fs.readFileSync(REPO_PACKAGE_JSON, 'utf8')).version;
            assert.strictEqual(read_package_version(REPO_PACKAGE_JSON), expected);
        });

        mocha.it('validate_bg_role accepts scanner and worker', function() {
            const { validate_bg_role } = load_bg_init_fresh();
            assert.strictEqual(validate_bg_role('scanner'), 'scanner');
            assert.strictEqual(validate_bg_role('worker'), 'worker');
        });

        mocha.it('validate_bg_role rejects missing or invalid roles', function() {
            const { validate_bg_role } = load_bg_init_fresh();
            // null does not trigger the NOOBAA_BG_ROLE default parameter.
            assert.throws(() => validate_bg_role(null), /NOOBAA_BG_ROLE must be one of/);
            assert.throws(() => validate_bg_role('all'), /NOOBAA_BG_ROLE must be one of/);
        });

        mocha.it('wait_for_mgmt_addr is a no-op without MGMT_ADDR', async function() {
            const { wait_for_mgmt_addr } = load_bg_init_fresh();
            // empty string does not trigger the MGMT_ADDR default parameter.
            await wait_for_mgmt_addr('', { timeout_ms: 50, interval_ms: 10 });
        });

        mocha.it('wait_for_mgmt_addr returns when the mgmt port accepts TCP', async function() {
            const server = net.createServer();
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const { port } = server.address();
            try {
                const { wait_for_mgmt_addr } = load_bg_init_fresh();
                await wait_for_mgmt_addr(`wss://127.0.0.1:${port}`, { timeout_ms: 2000, interval_ms: 20 });
            } finally {
                await new Promise(resolve => server.close(resolve));
            }
        });

        mocha.it('wait_for_mgmt_addr throws when the mgmt port never accepts TCP', async function() {
            const { wait_for_mgmt_addr } = load_bg_init_fresh();
            await assert.rejects(
                () => wait_for_mgmt_addr('wss://127.0.0.1:1', { timeout_ms: 80, interval_ms: 20 }),
                /not reachable/
            );
        });

        mocha.it('start calls bg_workers.main after validating role', async function() {
            const sandbox = sinon.createSandbox();
            const prev_role = process.env.NOOBAA_BG_ROLE;
            const prev_pkg = process.env.BG_INIT_TEST_PACKAGE_JSON;
            const prev_mgmt = process.env.MGMT_ADDR;
            process.env.NOOBAA_BG_ROLE = 'scanner';
            process.env.BG_INIT_TEST_PACKAGE_JSON = REPO_PACKAGE_JSON;
            delete process.env.MGMT_ADDR;

            const bg_workers_path = require.resolve('../../../server/bg_workers');
            const main_stub = sandbox.stub().resolves();
            require.cache[bg_workers_path] = {
                id: bg_workers_path,
                filename: bg_workers_path,
                loaded: true,
                exports: { main: main_stub },
            };

            try {
                const bg_init = load_bg_init_fresh();
                await bg_init.start();
                assert.strictEqual(main_stub.callCount, 1);
            } finally {
                sandbox.restore();
                delete require.cache[require.resolve('../../../cmd/bg_init')];
                delete require.cache[bg_workers_path];
                if (prev_role === undefined) delete process.env.NOOBAA_BG_ROLE;
                else process.env.NOOBAA_BG_ROLE = prev_role;
                if (prev_pkg === undefined) delete process.env.BG_INIT_TEST_PACKAGE_JSON;
                else process.env.BG_INIT_TEST_PACKAGE_JSON = prev_pkg;
                if (prev_mgmt === undefined) delete process.env.MGMT_ADDR;
                else process.env.MGMT_ADDR = prev_mgmt;
            }
        });
    });

    mocha.describe('repo layout parity', function() {

        mocha.it('bg_init.js has executable shebang for direct invocation', function() {
            const first_line = fs.readFileSync(BG_INIT_PATH, 'utf8').split('\n')[0];
            assert.strictEqual(first_line, '#!/usr/bin/env node');
        });

        mocha.it('api.new_router_from_env maps MGMT/MD/BG/HOSTED_AGENTS addrs', function() {
            const api = require('../../../api');
            assert.strictEqual(typeof api.new_router_from_env, 'function');
            const router = api.new_router_from_env({
                MGMT_ADDR: 'wss://mgmt:443',
                BG_ADDR: 'wss://localhost:8445',
                MD_ADDR: 'wss://s3:8444',
                HOSTED_AGENTS_ADDR: 'wss://mgmt:8446',
            });
            assert.strictEqual(router.bg, 'wss://localhost:8445');
            assert.strictEqual(router.default, 'wss://mgmt:443');
            assert.strictEqual(router.md, 'wss://s3:8444');
            assert.strictEqual(router.hosted_agents, 'wss://mgmt:8446');
        });
    });
});
