// make jshint ignore mocha globals
// /* global describe, it, before, after, beforeEach, afterEach */
/* global describe, it */
'use strict';

// var _ = require('lodash');
var assert = require('assert');
var LinkedList = require('../util/linked_list');

describe('linked_list', function() {

    it('should create ok', function() {
        var ll = new LinkedList();
        ll = ll; // for jshint no-unused-vars
    });

    it('should handle single item', function() {
        var ll = new LinkedList();
        assert(ll.is_empty());
        assert.strictEqual(ll.length, 0);
        var item = {
            foo: 'bar'
        };
        ll.push_front(item);
        assert.strictEqual(ll.get_front(), item);
        assert.strictEqual(ll.get_back(), item);
        assert(!ll.is_empty());
        assert.strictEqual(ll.length, 1);
        var pop_item = ll.pop_back();
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

    it('should throw mixing item between lists', function() {
        var l1 = new LinkedList();
        var l2 = new LinkedList();
        var item = {};
        l1.push_front(item);
        assert.throws(function() {
            l2.push_front(item);
        }, Error);
        assert.throws(function() {
            l2.remove(item);
        }, Error);
    });

});
