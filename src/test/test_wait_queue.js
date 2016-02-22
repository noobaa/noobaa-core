'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
var mocha = require('mocha');
var assert = require('assert');
var WaitQueue = require('../util/wait_queue');

mocha.describe('wait_queue', function() {

    mocha.it('should create ok', function() {
        var wq = new WaitQueue('a long name just for spite');
        wq = wq; // lint unused bypass
    });

    mocha.it('should return null when no items', function() {
        var wq = new WaitQueue();
        assert(!wq.wakeup());
    });

    mocha.it('should handle single item', function() {
        var wq;
        var woke = 0;
        var do_wake = function() {
            woke++;
        };
        var item = {
            foo: 'bar',
        };
        return P.fcall(function() {
            wq = new WaitQueue();
            assert.strictEqual(wq.length, 0);

            wq.wait().then(do_wake);
            assert.strictEqual(wq.length, 1);
            assert.strictEqual(woke, 0);

            wq.wakeup();

        }).delay(0).then(function() {
            assert.strictEqual(wq.length, 0);
            assert.strictEqual(woke, 1);

            wq.wait().then(do_wake).then(function() {
                item.foo += '!';
            });
            assert.strictEqual(wq.length, 1);
            assert.strictEqual(woke, 1);

            wq.wakeup();

        }).delay(0).then(function() {
            assert.strictEqual(wq.length, 0);
            assert.strictEqual(woke, 2);
            assert.deepEqual(item, {
                foo: 'bar!',
            });
        });
    });

});
