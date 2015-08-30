// make jshint ignore mocha globals
// /* global describe, it, before, after, beforeEach, afterEach */
/* global describe, it */
'use strict';

// var _ = require('lodash');
var assert = require('assert');
var dot = require('../util/dot');
var dot_engine = require('../util/dot_engine');
var dot_orig = require('dot');

describe('dot', function() {

    it('should return original dot', function() {
        assert.strictEqual(dot, dot_orig, 'expected original dot module to be returned');
    });

    describe('engine', function() {

        var engine = dot_engine();
        var orig_read_template = engine.read_template;

        it('should include string template', function() {
            engine.read_template = function(name) {
                if (name === 'ninja') {
                    return 'NINJA {{{= it.what }}}';
                } else if (name === 'turtles') {
                    return 'MUTANT {{{# def.include("ninja") }}}';
                } else {
                    throw new Error('bad template name ' + name);
                }
            };
            var ctx = {
                what: 'TURTLES'
            };
            var validate = function(data) {
                if (data !== 'MUTANT NINJA TURTLES') {
                    throw new Error('template engine did not produce NINJA TURTLES');
                }
            };
            // check twice to cover the caching code
            validate(engine('turtles', ctx));
            validate(engine('turtles', ctx));
            delete engine.templates.turtles;
            engine.disable_cache = true;
            validate(engine('turtles', ctx));
            validate(engine('turtles', ctx));
        });

        it('should include file template', function(callback) {
            engine.read_template = function(name) {
                if (name === 'foo') {
                    return '{"foomanchu": {{{# def.include("package.json",{a:1}) }}} }';
                } else {
                    return orig_read_template(name);
                }
            };
            engine('foo', {}, function(err, data) {
                if (err) {
                    return callback(err);
                }
                try {
                    var json = JSON.parse(data);
                    if (typeof(json) !== 'object' ||
                        typeof(json.foomanchu) !== 'object' || json.foomanchu.name !== 'noobaa-util') {
                        callback(new Error('template engine did not produce package.json'));
                    }
                    return callback();
                } catch (err) {
                    return callback(err);
                }
            });
        });
    });

});
