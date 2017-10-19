/* Copyright (C) 2016 NooBaa */
'use strict';

// var _ = require('lodash');
var P = require('../../util/promise');
var promise_utils = require('../../util/promise_utils');
var mocha = require('mocha');
var assert = require('assert');
var KeysSemaphore = require('../../util/keys_semaphore');

mocha.describe('keys_semaphore', function() {

    mocha.it('should create ok', function() {
        var ks = new KeysSemaphore(3);
        assert.strictEqual(ks.has_semaphore('not_exist'), false);
    });

    mocha.it('should allow on empty semaphore', function() {
        var ks = new KeysSemaphore(3);
        let func_executed = false;

        function func() {
            func_executed = true;
        }

        assert.strictEqual(func_executed, false);

        return ks.surround_key('test1', func)
            .then(() => {
                assert.strictEqual(func_executed, true);
            });
    });


    mocha.it('should allow 2 callers', function() {
        var ks = new KeysSemaphore(3, {
            timeout: 5000
        });
        let func1_executed = false;
        let func2_executed = false;

        function func1() {
            func1_executed = true;
            // func1 will not finish before func2 is executed
            return promise_utils.pwhile(
                () => !func2_executed,
                () => P.delay(100));
        }

        function func2() {
            func2_executed = true;
        }

        ks.surround_key('test2', func1);

        return ks.surround_key('test2', func2)
            .then(() => {
                assert.strictEqual(func1_executed, true);
                assert.strictEqual(func2_executed, true);
            });

    });



});
