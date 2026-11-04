/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const sinon = require('sinon');

const bg_workers = require('../../../server/bg_workers');

mocha.describe('bg_workers', function() {

    mocha.describe('unit', function() {

        mocha.it('get_bg_workers_mode accepts default and executor', function() {
            const { BG_WORKERS_MODES, get_bg_workers_mode } = bg_workers;
            assert.strictEqual(get_bg_workers_mode(BG_WORKERS_MODES.DEFAULT), 'default');
            assert.strictEqual(get_bg_workers_mode(BG_WORKERS_MODES.EXECUTOR), 'executor');
        });

        mocha.it('get_bg_workers_mode uses default when the env var is unset', function() {
            const { get_bg_workers_mode } = bg_workers;
            const prev_mode = process.env.BG_WORKERS_MODE;
            delete process.env.BG_WORKERS_MODE;
            try {
                assert.strictEqual(get_bg_workers_mode(), 'default');
            } finally {
                if (prev_mode === undefined) delete process.env.BG_WORKERS_MODE;
                else process.env.BG_WORKERS_MODE = prev_mode;
            }
        });

        mocha.it('get_bg_workers_mode reads executor from BG_WORKERS_MODE', function() {
            const { get_bg_workers_mode } = bg_workers;
            const prev_mode = process.env.BG_WORKERS_MODE;
            process.env.BG_WORKERS_MODE = 'executor';
            try {
                assert.strictEqual(get_bg_workers_mode(), 'executor');
            } finally {
                if (prev_mode === undefined) delete process.env.BG_WORKERS_MODE;
                else process.env.BG_WORKERS_MODE = prev_mode;
            }
        });

        mocha.it('get_bg_workers_mode rejects an invalid mode', function() {
            const { get_bg_workers_mode } = bg_workers;
            // null does not trigger the BG_WORKERS_MODE default parameter.
            assert.throws(() => get_bg_workers_mode(null), /invalid BG_WORKERS_MODE: null/);
            assert.throws(() => get_bg_workers_mode('all'), /invalid BG_WORKERS_MODE: all/);
        });

        mocha.it('executor mode exits on SIGTERM', function() {
            const sandbox = sinon.createSandbox();
            const exit_stub = sandbox.stub(process, 'exit');
            const before = new Set(process.listeners('SIGTERM'));
            try {
                bg_workers.install_executor_sigterm_handler();
                process.emit('SIGTERM');
                assert.strictEqual(exit_stub.calledOnce, true);
                assert.strictEqual(exit_stub.firstCall.args[0], 0);
            } finally {
                for (const listener of process.listeners('SIGTERM')) {
                    if (!before.has(listener)) process.removeListener('SIGTERM', listener);
                }
                sandbox.restore();
            }
        });
    });

    mocha.describe('repo layout parity', function() {

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
