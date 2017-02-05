/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var mocha = require('mocha');
var assert = require('assert');
var JobQueue = require('../../util/job_queue');

mocha.describe('job_queue', function() {


    mocha.it('should create ok', function() {
        var q = new JobQueue();
        _.noop(q); // lint unused bypass
    });


    mocha.it('should process an item', function(done) {
        var q = new JobQueue({
            concurrency: 1,
        });
        assert.strictEqual(q.length, 0);
        var job = {
            run: function() {
                assert_callback_equal(q.length, 0, done);
                done();
            }
        };
        q.add(job);
        // item is dispatched immediately
        assert_callback_equal(q.length, 0, done);
    });


    mocha.it('should handle explicit job_method param', function(done) {
        var q = new JobQueue({
            concurrency: 1,
            job_method: 'foo',
        });
        assert.strictEqual(q.length, 0);
        var job = {
            foo: function() {
                assert_callback_equal(q.length, 0, done);
                done();
            }
        };
        q.add(job);
        // item is dispatched immediately
        assert_callback_equal(q.length, 0, done);
    });


    mocha.it('should process manually', function(done) {
        var q = new JobQueue({
            concurrency: 0
        });
        var was_done = false;
        assert.strictEqual(q.length, 0);
        var job = {
            run: function() {
                assert_callback_equal(q.length, 0, done);
                assert_callback(!was_done, done);
                was_done = true;
                done();
            }
        };
        q.add(job);
        setTimeout(function() {
            assert_callback_equal(q.length, 1, done);
            assert_callback(!was_done, done);
            q.process();
            assert_callback_equal(q.length, 0, done);
        }, 1);
    });


    mocha.it('should remove queued item', function(done) {
        var q = new JobQueue(); // default should be concurrency 0
        assert.strictEqual(q.length, 0);
        var job = {
            run: /* istanbul ignore next */ function() {
                done(new Error('unexpected call to item run'));
            }
        };
        q.add(job);
        setTimeout(function() {
            assert_callback_equal(q.length, 1, done);
            q.remove(job);
            assert_callback_equal(q.length, 0, done);
            setTimeout(done, 1);
        }, 1);
    });


    mocha.it('should handle promises with concurrency', function(done) {
        var count = 0;
        var concurrency = 5;
        var q = new JobQueue({
            concurrency: concurrency
        });
        var run_count = 0;
        var num_jobs = 0;

        function add_job() {
            var job_id = num_jobs;
            num_jobs += 1;
            var job = {
                run: function() {
                    function run_inner() {
                        run_count += 1;
                        assert_callback(run_count <= count, done, 'run was called too many times');
                        if (run_count === count) {
                            done();
                        } else if (job_id % 3 !== 0) {
                            throw new Error('*** this is an expected exception thrown by the test ***');
                        }
                    }
                    if (job_id % 2 === 0) {
                        return P.delay(1).then(run_inner);
                    } else {
                        run_inner();
                        return {};
                    }
                }
            };
            count += 1;
            q.add(job);
            if (count < concurrency) {
                assert_callback_equal(q.length, 0, done);
            } else {
                assert_callback_equal(q.length, count - concurrency, done);
            }
        }
        for (var i = 0; i < 2 * concurrency; i++) {
            add_job();
        }
    });

});

function assert_callback(condition, callback, message) {

    /* istanbul ignore if */
    if (!condition) {
        message = message || 'assertion failed (no message)';
        callback(message); // eslint-disable-line callback-return
        throw new Error(message);
    }
}

function assert_callback_equal(x, y, callback) {
    assert_callback(x === y, callback, 'found ' + x + ' expected ' + y);
}
