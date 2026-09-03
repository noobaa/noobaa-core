/* Copyright (C) 2026 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const sinon = require('sinon');

const P = require('../../../util/promise');
const { get_instance } = require('../../../util/background_scheduler');

async function wait_for(condition_fn, timeout_ms = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout_ms) {
        if (condition_fn()) return;
        await P.delay(10);
    }
    throw new Error('timeout waiting for condition');
}

mocha.describe('background_scheduler', function() {
    this.timeout(10000); // eslint-disable-line no-invalid-this

    let scheduler;
    const worker_names = [];

    mocha.beforeEach(function() {
        scheduler = get_instance();
    });

    mocha.afterEach(function() {
        for (const name of worker_names) {
            scheduler.remove_background_worker(name);
        }
        worker_names.length = 0;
        sinon.restore();
    });

    function register_worker(worker, run_batch_function, pre_batch_fn) {
        worker_names.push(worker.name);
        scheduler.register_bg_worker(worker, run_batch_function, pre_batch_fn);
    }

    mocha.it('runs run_batch without pre_batch_fn', async function() {
        let batch_count = 0;
        const worker = {
            name: 'bg-scheduler-no-prebatch-' + Date.now(),
            run_immediate: true,
            delay: 5,
        };

        register_worker(worker, async () => {
            batch_count += 1;
            if (batch_count >= 2) {
                scheduler.remove_background_worker(worker.name);
            }
            return 5;
        });

        await wait_for(() => batch_count >= 2);
        assert.strictEqual(batch_count, 2);
    });

    mocha.it('runs pre_batch_fn before run_batch', async function() {
        const events = [];
        const worker = {
            name: 'bg-scheduler-prebatch-order-' + Date.now(),
            run_immediate: true,
            delay: 5,
        };

        register_worker(
            worker,
            async () => {
                events.push('run_batch');
                scheduler.remove_background_worker(worker.name);
                return 5;
            },
            async () => {
                events.push('pre_batch');
            }
        );

        await wait_for(() => events.includes('run_batch'));
        assert.deepStrictEqual(events, ['pre_batch', 'run_batch']);
    });

    mocha.it('pre_batch_fn error still runs run_batch for that cycle', async function() {
        let batch_count = 0;
        let pre_batch_count = 0;
        const worker = {
            name: 'bg-scheduler-prebatch-error-' + Date.now(),
            run_immediate: true,
            delay: 5,
        };

        register_worker(
            worker,
            async () => {
                batch_count += 1;
                scheduler.remove_background_worker(worker.name);
                return 5;
            },
            async () => {
                pre_batch_count += 1;
                throw new Error('pre_batch failed');
            }
        );

        await wait_for(() => batch_count >= 1);
        assert.strictEqual(batch_count, 1,
            'run_batch should still run when pre_batch fails');
        assert.strictEqual(pre_batch_count, 1);
    });

    mocha.it('run_batch error does not stop the worker loop', async function() {
        let batch_count = 0;
        const worker = {
            name: 'bg-scheduler-runbatch-error-' + Date.now(),
            run_immediate: true,
            delay: 5,
        };

        register_worker(worker, async () => {
            batch_count += 1;
            if (batch_count === 1) {
                throw new Error('run_batch failed');
            }
            scheduler.remove_background_worker(worker.name);
            return 5;
        });

        await wait_for(() => batch_count >= 2);
        assert.strictEqual(batch_count, 2);
    });

    mocha.it('register_bg_worker rejects non-function pre_batch_fn', function() {
        const worker = {
            name: 'bg-scheduler-invalid-prebatch-' + Date.now(),
            run_immediate: true,
            delay: 5,
            run_batch: async () => 5,
        };

        assert.throws(
            () => register_worker(worker, undefined, 'not-a-function'),
            /pre_batch_fn is not a function/
        );
    });

    mocha.it('remove_background_worker stops further batches', async function() {
        let batch_count = 0;
        const worker = {
            name: 'bg-scheduler-remove-' + Date.now(),
            run_immediate: true,
            delay: 5,
        };

        register_worker(worker, async () => {
            batch_count += 1;
            scheduler.remove_background_worker(worker.name);
            return 5;
        });

        await wait_for(() => batch_count >= 1);
        const count_after_first = batch_count;
        await P.delay(50);
        assert.strictEqual(batch_count, count_after_first,
            'worker should not run again after removal');
    });

    mocha.it('re-registering a worker stops the previous worker loop', async function() {
        let first_batch_count = 0;
        let second_batch_count = 0;
        const worker_name = 'bg-scheduler-reregister-' + Date.now();

        const first_worker = {
            name: worker_name,
            run_immediate: true,
            delay: 5,
        };
        register_worker(first_worker, async () => {
            first_batch_count += 1;
            return 5;
        });

        await wait_for(() => first_batch_count >= 1);

        const second_worker = {
            name: worker_name,
            run_immediate: true,
            delay: 5,
        };
        register_worker(second_worker, async () => {
            second_batch_count += 1;
            if (second_batch_count >= 2) {
                scheduler.remove_background_worker(worker_name);
            }
            return 5;
        });

        await wait_for(() => second_batch_count >= 2);

        const first_count_at_end = first_batch_count;
        await P.delay(50);
        assert.strictEqual(first_batch_count, first_count_at_end,
            'first worker loop should stop after re-registration');
        assert.ok(second_batch_count >= 2);
    });
});
