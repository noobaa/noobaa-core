// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('underscore');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');
var Agent = require('./agent');

describe('agent', function() {

    it('should connect', function() {
        new Agent({
            node_name: 'a',
            account_login: {
                email: 'a@a.a',
                password: 'a',
            },
        }).connect();
    });

});
