/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const sinon = require('sinon');

const config = require('../../../../config');
const LEASE_UTILS = require.resolve('../../../util/leader_election');

const TEST_LEASE_DURATION_SECONDS = 60;

/** @type {typeof import('../../../util/leader_election')} */
let lease_utils;

function make_test_client() {
    return new lease_utils.LeaderElector({ lease_name: 'noobaa-core', holder: 'pod-a' });
}

function fresh_lease(holder = 'pod-a') {
    return {
        spec: {
            holderIdentity: holder,
            renewTime: new Date().toISOString(),
            leaseDurationSeconds: TEST_LEASE_DURATION_SECONDS,
        },
    };
}

mocha.describe('leader_election', function() {

    let _k8s_host;
    let _k8s_port;

    mocha.before(function() {
        this.timeout(15000); // eslint-disable-line no-invalid-this
        _k8s_host = process.env.KUBERNETES_SERVICE_HOST;
        _k8s_port = process.env.KUBERNETES_SERVICE_PORT;
        process.env.KUBERNETES_SERVICE_HOST ||= '127.0.0.1';
        process.env.KUBERNETES_SERVICE_PORT ||= '443';
        delete require.cache[LEASE_UTILS];
        lease_utils = require(LEASE_UTILS);
    });

    mocha.after(function() {
        if (_k8s_host === undefined) delete process.env.KUBERNETES_SERVICE_HOST;
        else process.env.KUBERNETES_SERVICE_HOST = _k8s_host;
        if (_k8s_port === undefined) delete process.env.KUBERNETES_SERVICE_PORT;
        else process.env.KUBERNETES_SERVICE_PORT = _k8s_port;
        delete require.cache[LEASE_UTILS];
    });

    mocha.it('parse_lease_time returns 0 for empty input', function() {
        assert.strictEqual(lease_utils.parse_lease_time(undefined), 0);
        assert.strictEqual(lease_utils.parse_lease_time(''), 0);
    });

    mocha.it('format_lease_time pads milliseconds to microseconds for K8s MicroTime', function() {
        const d = new Date('2026-06-02T11:53:47.665Z');
        assert.strictEqual(lease_utils.format_lease_time(d), '2026-06-02T11:53:47.665000Z');
    });

    mocha.it('format_lease_time pads zero milliseconds', function() {
        const d = new Date('2026-06-02T11:53:47.000Z');
        assert.strictEqual(lease_utils.format_lease_time(d), '2026-06-02T11:53:47.000000Z');
    });

    mocha.it('is_lease_expired when renewTime is missing', function() {
        assert.strictEqual(lease_utils.is_lease_expired({ spec: { holderIdentity: 'pod-a' } }), true);
    });

    mocha.it('is_lease_expired when renew window elapsed', function() {
        const old = new Date(Date.now() - (120 * 1000)).toISOString();
        const lease = {
            spec: {
                holderIdentity: 'pod-a',
                renewTime: old,
                leaseDurationSeconds: TEST_LEASE_DURATION_SECONDS,
            },
        };
        assert.strictEqual(lease_utils.is_lease_expired(lease), true);
    });

    mocha.it('is_lease_expired false when renew is fresh', function() {
        const lease = {
            spec: {
                holderIdentity: 'pod-a',
                renewTime: new Date().toISOString(),
                leaseDurationSeconds: TEST_LEASE_DURATION_SECONDS,
            },
        };
        assert.strictEqual(lease_utils.is_lease_expired(lease), false);
    });

    mocha.it('is_lease_takeable when empty holder', function() {
        assert.strictEqual(lease_utils.is_lease_takeable({ spec: {} }, 'pod-a'), true);
    });

    mocha.it('is_lease_takeable when same holder', function() {
        const lease = {
            spec: {
                holderIdentity: 'pod-a',
                renewTime: new Date().toISOString(),
                leaseDurationSeconds: TEST_LEASE_DURATION_SECONDS,
            },
        };
        assert.strictEqual(lease_utils.is_lease_takeable(lease, 'pod-a'), true);
    });

    mocha.it('cannot take lease held by another fresh holder', function() {
        const lease = {
            spec: {
                holderIdentity: 'pod-a',
                renewTime: new Date().toISOString(),
                leaseDurationSeconds: TEST_LEASE_DURATION_SECONDS,
            },
        };
        assert.strictEqual(lease_utils.is_lease_takeable(lease, 'pod-b'), false);
    });

    mocha.it('can take lease when other holder expired', function() {
        const lease = {
            spec: {
                holderIdentity: 'pod-a',
                renewTime: new Date(Date.now() - (120 * 1000)).toISOString(),
                leaseDurationSeconds: TEST_LEASE_DURATION_SECONDS,
            },
        };
        assert.strictEqual(lease_utils.is_lease_takeable(lease, 'pod-b'), true);
    });

    mocha.it('cannot take lease when renewTime is old but observed_change_ms is recent (clock skew protection)', function() {
        // renewTime looks expired but we locally observed the lease change just now,
        // so the other pod's clock is skewed behind ours — we must not steal the lease.
        const lease = {
            spec: {
                holderIdentity: 'pod-a',
                renewTime: new Date(Date.now() - (120 * 1000)).toISOString(),
                leaseDurationSeconds: TEST_LEASE_DURATION_SECONDS,
            },
        };
        const observed_change_ms = Date.now(); // just observed it locally
        assert.strictEqual(lease_utils.is_lease_takeable(lease, 'pod-b', observed_change_ms), false);
    });

    mocha.it('is_lease_held_by matches holder identity', function() {
        const lease = { spec: { holderIdentity: 'pod-a' } };
        assert.strictEqual(lease_utils.is_lease_held_by(lease, 'pod-a'), true);
        assert.strictEqual(lease_utils.is_lease_held_by(lease, 'pod-b'), false);
    });

    mocha.it('is_lease_held_by false when holder was cleared', function() {
        assert.strictEqual(lease_utils.is_lease_held_by({ spec: { holderIdentity: '' } }, 'pod-a'), false);
        assert.strictEqual(lease_utils.is_lease_takeable({ spec: { holderIdentity: '' } }, 'pod-b'), true);
    });

    mocha.describe('release_lease', function() {
        /** @type {sinon.SinonSandbox} */
        let sandbox;

        mocha.beforeEach(function() {
            sandbox = sinon.createSandbox();
        });

        mocha.afterEach(function() {
            sandbox.restore();
        });

        mocha.it('skips release when held by another pod', async function() {
            const client = make_test_client();
            sandbox.stub(client, 'read_lease').resolves(fresh_lease('pod-b'));
            const put_stub = sandbox.stub(client, '_put_release_lease');
            await client.release_lease();
            assert.strictEqual(put_stub.called, false);
        });

        mocha.it('logs warning on non-200 status without retrying', async function() {
            const client = make_test_client();
            sandbox.stub(client, 'read_lease').resolves(fresh_lease('pod-a'));
            const put_stub = sandbox.stub(client, '_put_release_lease').resolves(409);
            await client.release_lease();
            assert.strictEqual(put_stub.callCount, 1);
        });

        mocha.it('handles transient errors gracefully without throwing', async function() {
            const client = make_test_client();
            sandbox.stub(client, 'read_lease').rejects(new Error('network error'));
            await assert.doesNotReject(() => client.release_lease());
        });
    });

    mocha.describe('acquire_lease', function() {
        /** @type {sinon.SinonSandbox} */
        let sandbox;

        mocha.beforeEach(function() {
            sandbox = sinon.createSandbox();
        });

        mocha.afterEach(function() {
            sandbox.restore();
        });

        mocha.it('retries on transient network error and eventually acquires', async function() {
            const client = make_test_client();
            const orig_retry = config.CORE_LEASE_ACQUIRE_RETRY_MS;
            config.CORE_LEASE_ACQUIRE_RETRY_MS = 10;
            try {
                const abort_err = new DOMException('The operation was aborted', 'AbortError');
                const read_stub = sandbox.stub(client, 'read_lease_state');
                read_stub.onFirstCall().rejects(abort_err);
                read_stub.onSecondCall().resolves({ lease: fresh_lease('pod-a'), can_take: true });
                sandbox.stub(client, 'update_lease').resolves(200);
                await client.acquire_lease();
                assert.strictEqual(read_stub.callCount, 2);
            } finally {
                config.CORE_LEASE_ACQUIRE_RETRY_MS = orig_retry;
            }
        });

        mocha.it('exits early when _stop_requested is set before retrying', async function() {
            const client = make_test_client();
            const update_stub = sandbox.stub(client, 'update_lease');
            sandbox.stub(client, 'read_lease_state').callsFake(async function() {
                client._stop_requested = true;
                return { lease: fresh_lease('pod-a'), can_take: false };
            });
            await client.acquire_lease();
            assert.strictEqual(update_stub.called, false);
        });
    });

    mocha.describe('start and stop', function() {
        /** @type {sinon.SinonSandbox} */
        let sandbox;

        mocha.beforeEach(function() {
            sandbox = sinon.createSandbox();
        });

        mocha.afterEach(function() {
            sandbox.restore();
        });

        mocha.it('start emits EVENTS.LEADERSHIP_ACQUIRED after acquiring the lease', async function() {
            const client = make_test_client();
            sandbox.stub(client, 'acquire_lease').resolves();
            sandbox.stub(client, 'renew_lease_loop').resolves();
            const on_acquired = sandbox.stub();
            client.on(lease_utils.EVENTS.LEADERSHIP_ACQUIRED, on_acquired);
            await client.start();
            assert.strictEqual(on_acquired.calledOnce, true);
        });

        mocha.it('stop calls stop_running then release_lease', async function() {
            const client = make_test_client();
            const stop_running_stub = sandbox.stub(client, 'stop_running').resolves();
            const release_stub = sandbox.stub(client, 'release_lease').resolves();
            await client.stop();
            assert.strictEqual(stop_running_stub.calledOnce, true);
            assert.strictEqual(release_stub.calledOnce, true);
            assert.ok(stop_running_stub.calledBefore(release_stub));
        });

        mocha.it('stop() during acquire_lease prevents LEADERSHIP_ACQUIRED and renew loop', async function() {
            const client = make_test_client();
            sandbox.stub(client, 'acquire_lease').callsFake(async function() {
                client._stop_requested = true;
            });
            const renew_stub = sandbox.stub(client, 'renew_lease_loop').resolves();
            const on_acquired = sandbox.stub();
            client.on(lease_utils.EVENTS.LEADERSHIP_ACQUIRED, on_acquired);
            await client.start();
            assert.strictEqual(on_acquired.called, false);
            assert.strictEqual(renew_stub.called, false);
        });
    });

    mocha.describe('renew_lease_loop', function() {
        /** @type {sinon.SinonSandbox} */
        let sandbox;

        mocha.beforeEach(function() {
            sandbox = sinon.createSandbox();
        });

        mocha.afterEach(function() {
            sandbox.restore();
        });

        mocha.it('steps down when another holder is observed', async function() {
            const client = make_test_client();
            client._lease_duration_ms = 60000;
            sandbox.stub(client, 'read_lease_state').resolves({
                lease: fresh_lease('pod-b'),
                can_take: false,
            });
            const on_lost = sandbox.stub();
            client.on(lease_utils.EVENTS.LEADERSHIP_LOST, on_lost);
            await client.renew_lease_loop();
            assert.strictEqual(on_lost.calledOnce, true);
        });

        mocha.it('steps down when renew deadline is exceeded without a successful PUT', async function() {
            const client = make_test_client();
            // deadline = lease_duration - error_sleep - request_timeout - margin = 100 - 10 - 10 - 10 = 70ms
            client._lease_duration_ms = 100;
            const orig_error_sleep = config.CORE_LEASE_RENEW_ERROR_SLEEP_MS;
            const orig_request_timeout = config.CORE_LEASE_REQUEST_TIMEOUT_MS;
            const orig_margin = config.LEASE_RENEW_DEADLINE_MARGIN_MS;
            config.CORE_LEASE_RENEW_ERROR_SLEEP_MS = 10;
            config.CORE_LEASE_REQUEST_TIMEOUT_MS = 10;
            config.LEASE_RENEW_DEADLINE_MARGIN_MS = 10;
            try {
                sandbox.stub(client, 'read_lease_state').resolves({
                    lease: fresh_lease('pod-a'),
                    can_take: true,
                });
                sandbox.stub(client, 'update_lease').resolves(500);
                const on_lost = sandbox.stub();
                client.on(lease_utils.EVENTS.LEADERSHIP_LOST, on_lost);
                await client.renew_lease_loop();
                assert.strictEqual(on_lost.calledOnce, true);
            } finally {
                config.CORE_LEASE_RENEW_ERROR_SLEEP_MS = orig_error_sleep;
                config.CORE_LEASE_REQUEST_TIMEOUT_MS = orig_request_timeout;
                config.LEASE_RENEW_DEADLINE_MARGIN_MS = orig_margin;
            }
        });

        mocha.it('treats thrown error (e.g. request timeout) as transient and steps down at deadline', async function() {
            const client = make_test_client();
            // deadline = lease_duration - error_sleep - request_timeout - margin = 100 - 10 - 10 - 10 = 70ms
            client._lease_duration_ms = 100;
            const orig_error_sleep = config.CORE_LEASE_RENEW_ERROR_SLEEP_MS;
            const orig_request_timeout = config.CORE_LEASE_REQUEST_TIMEOUT_MS;
            const orig_margin = config.LEASE_RENEW_DEADLINE_MARGIN_MS;
            config.CORE_LEASE_RENEW_ERROR_SLEEP_MS = 10;
            config.CORE_LEASE_REQUEST_TIMEOUT_MS = 10;
            config.LEASE_RENEW_DEADLINE_MARGIN_MS = 10;
            try {
                const abort_err = new DOMException('The operation was aborted', 'AbortError');
                sandbox.stub(client, 'read_lease_state').rejects(abort_err);
                const on_lost = sandbox.stub();
                client.on(lease_utils.EVENTS.LEADERSHIP_LOST, on_lost);
                await client.renew_lease_loop();
                assert.strictEqual(on_lost.calledOnce, true);
            } finally {
                config.CORE_LEASE_RENEW_ERROR_SLEEP_MS = orig_error_sleep;
                config.CORE_LEASE_REQUEST_TIMEOUT_MS = orig_request_timeout;
                config.LEASE_RENEW_DEADLINE_MARGIN_MS = orig_margin;
            }
        });

        mocha.it('stop_running exits without emitting EVENTS.LEADERSHIP_LOST', async function() {
            const client = make_test_client();
            client._lease_duration_ms = 60000; // large duration so deadline is not immediately exceeded
            const orig_retry = config.CORE_LEASE_ACQUIRE_RETRY_MS;
            config.CORE_LEASE_ACQUIRE_RETRY_MS = 5000;
            try {
                sandbox.stub(client, 'read_lease_state').resolves({
                    lease: fresh_lease('pod-a'),
                    can_take: true,
                });
                sandbox.stub(client, 'update_lease').resolves(200);
                const on_lost = sandbox.stub();
                client.on(lease_utils.EVENTS.LEADERSHIP_LOST, on_lost);
                const loop_promise = client.renew_lease_loop();
                await client.stop_running();
                await loop_promise;
                assert.strictEqual(on_lost.called, false);
            } finally {
                config.CORE_LEASE_ACQUIRE_RETRY_MS = orig_retry;
            }
        });
    });
});
