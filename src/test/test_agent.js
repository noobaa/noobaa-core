// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');
var Agent = require('../agent/agent');
var agent_api = require('../api/agent_api');

describe('agent', function() {

    it('should run agents', function(done) {
        Q.fcall(
            function() {
                var allocated_size = {
                    gb: 1
                };
                return coretest.init_test_nodes(10, allocated_size);
            }
        ).then(
            function() {
                coretest.clear_test_nodes();
            }
        ).nodeify(done);
    });

});
