/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const LinkedList = require('../../../util/linked_list');

mocha.describe('linked_list', function() {

    mocha.it('should create ok', function() {
        const ll = new LinkedList();
        _.noop(ll); // lint unused bypass
    });

    mocha.it('should handle single item', function() {
        const ll = new LinkedList();
        assert(ll.is_empty());
        assert.strictEqual(ll.length, 0);
        const item = {
            foo: 'bar'
        };
        ll.push_front(item);
        assert.strictEqual(ll.get_front(), item);
        assert.strictEqual(ll.get_back(), item);
        assert(!ll.is_empty());
        assert.strictEqual(ll.length, 1);
        const pop_item = ll.pop_back();
        assert.strictEqual(pop_item, item);
        assert.strictEqual(ll.length, 0);
        assert(ll.is_empty());
        // check that removing again does nothing
        assert(!ll.remove(item));
        assert.strictEqual(ll.length, 0);
        assert(ll.is_empty());
        assert(!ll.pop_front());
        assert(!ll.pop_back());
    });

    mocha.it('should throw mixing item between lists', function() {
        const l1 = new LinkedList();
        const l2 = new LinkedList();
        const item = {};
        l1.push_front(item);
        assert.throws(function() {
            l2.push_front(item);
        }, Error);
        assert.throws(function() {
            l2.remove(item);
        }, Error);
    });

});
