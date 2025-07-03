/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const { setTimeout: delay, setImmediate: immediate } = require('node:timers/promises');

const error_utils = require('../../../util/error_utils');
const DelayedTrigger = require('../../../util/delayed_trigger');
const WaitQueue = require('../../../util/wait_queue');

// class to test the expectations from DelayedTrigger
class TriggerTester {

    counter = 0;
    holder = new WaitQueue();
    notifier = new WaitQueue();
    fail = false;
    dt = new DelayedTrigger({
        delay: 10,
        max_retries: 3,
        on_trigger: () => this.on_trigger(),
    });

    async test_once(concur = false) {
        console.log('test_once:', this.counter);
        this.assert_state();
        this.dt.trigger();
        await this.pull_trigger(concur);
        this.assert_state();
    }

    async test_fail_and_recover(concur = false) {
        console.log('test_fail_and_recover:', this.counter);
        const counter = this.counter;

        this.fail = true;
        this.assert_state();
        this.dt.trigger();

        await this.pull_trigger();
        this.fail = false;
        await this.pull_trigger(concur);

        this.assert_state(counter + 2 + (concur ? 1 : 0));
    }

    async test_fail_exhausted() {
        console.log('test_fail_exhausted:', this.counter);
        const counter = this.counter;

        // set fail flag will keep failing until exhausted
        this.fail = true;
        this.assert_state();
        this.dt.trigger();

        // for now this test is hardcoded for 3 max retries
        assert.strictEqual(this.dt._max_retries, 3);
        await this.pull_trigger();
        await this.pull_trigger();
        await this.pull_trigger();
        await this.pull_trigger(false, false);

        this.assert_state(counter + 4);
        this.fail = false;
    }

    async pull_trigger(concur = false, fail = this.fail) {
        const counter = this.counter;
        assert.strictEqual(this.dt.is_timer(), true);

        await this.notifier.wait();
        this.assert_state(counter, false, false, true, 1, 0);

        // we can't really add more than one pending because trigger will refuse to add
        if (concur) {
            this.dt.trigger();
            this.assert_state(counter, true, false, true, 1, 0);
            await delay(this.dt._delay);
            this.assert_state(counter, false, true, true, 1, 0);
        }

        // ack to the initial trigger
        this.holder.wakeup();
        await this.notifier.wait();
        this.assert_state(counter + 1, false, concur, true, 1, 0);

        // ack to the pending trigger
        if (concur) {
            this.holder.wakeup();
            await this.notifier.wait();
            this.assert_state(counter + 1, false, false, true, 1, 0);

            this.holder.wakeup();
            await this.notifier.wait();
            this.assert_state(counter + 2, false, false, true, 1, 0);
        }

        this.holder.wakeup();
        await immediate();
        this.assert_state(counter + 1 + (concur ? 1 : 0), fail, false, false, 0, 0);
    }

    // the tested trigger callback function
    async on_trigger() {
        // wakeup the caller and wait for it to ack back
        this.notifier.wakeup();
        await this.holder.wait();

        this.counter += 1;

        // wakeup the caller and wait for it to ack back
        this.notifier.wakeup();
        await this.holder.wait();

        // fail only after the last ack so the caller can be ready
        if (this.fail) {
            throw error_utils.stackless(new Error('TEST ERROR INJECTION'));
        }
    }

    assert_state(c = undefined, t = false, p = false, r = false, h = 0, n = 0) {
        // console.log('counter', this.counter, 'expect', c);
        if (c) assert.strictEqual(this.counter, c, 'counter');
        assert.strictEqual(this.dt.is_timer(), t, 'is_timer');
        assert.strictEqual(this.dt.is_pending(), p, 'is_pending');
        assert.strictEqual(this.dt.is_running(), r, 'is_running');
        assert.strictEqual(this.holder.length, h);
        assert.strictEqual(this.notifier.length, n);
    }
}


mocha.describe('DelayedTrigger', function() {

    mocha.it('should trigger one by one', async function() {
        const t = new TriggerTester();
        for (let i = 0; i < 10; ++i) {
            await t.test_once(i % 2 === 0);
        }
    });

    mocha.it('should trigger fail once and recover', async function() {
        const t = new TriggerTester();
        for (let i = 0; i < 10; ++i) {
            await t.test_fail_and_recover(i % 2 === 0);
        }
    });

    mocha.it('should trigger fail until exhausted', async function() {
        const t = new TriggerTester();
        for (let i = 0; i < 10; ++i) {
            await t.test_fail_exhausted();
        }
    });

});

