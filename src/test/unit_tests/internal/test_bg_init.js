/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');

const BG_INIT_PATH = path.resolve(__dirname, '../../../cmd/bg_init.js');

function load_bg_init_fresh() {
    const module_path = require.resolve('../../../cmd/bg_init');
    delete require.cache[module_path];
    return require('../../../cmd/bg_init');
}

mocha.describe('bg_init', function() {

    mocha.describe('unit', function() {

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

        mocha.it('start calls bg_workers.main after validating role', async function() {
            const sandbox = sinon.createSandbox();
            const prev_role = process.env.NOOBAA_BG_ROLE;
            process.env.NOOBAA_BG_ROLE = 'scanner';

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

        mocha.it('legacy cluster heartbeat writers are removed', function() {
            const repo_root = path.resolve(__dirname, '../../../../');
            const bg_workers = fs.readFileSync(
                path.join(repo_root, 'src/server/bg_workers.js'), 'utf8');
            const system_server = fs.readFileSync(
                path.join(repo_root, 'src/server/system_services/system_server.js'), 'utf8');
            const config_js = fs.readFileSync(path.join(repo_root, 'config.js'), 'utf8');

            assert.doesNotMatch(bg_workers, /cluster_heartbeat_writer/);
            assert.doesNotMatch(bg_workers, /cluster_hb/);
            assert.doesNotMatch(system_server, /init_cluster/);
            assert.doesNotMatch(config_js, /CLUSTER_HB_INTERVAL/);
            assert.doesNotMatch(config_js, /CLUSTER_NODE_MISSING_TIME/);
            assert.ok(!fs.existsSync(path.join(repo_root, 'src/server/bg_services/cluster_hb.js')));
            assert.ok(!fs.existsSync(path.join(repo_root, 'src/server/bg_services/server_monitor.js')));
        });
    });
});
