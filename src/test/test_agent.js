// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');
var Agent = require('../agent/agent');
var agent_api = require('../api/agent_api');
var size_utils = require('../util/size_utils');

describe('agent', function() {

    it('should run agents', function(done) {
        Q.fcall(
            function() {
                return coretest.init_test_nodes(10, size_utils.GIGABYTE);
            }
        ).then(
            function() {
                coretest.clear_test_nodes();
            }
        ).nodeify(done);
    });

});
