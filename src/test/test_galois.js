// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var GF = require('../util/galois');


describe('galois', function() {

    _.each(GF.PRIMITIVE_POLYNOMS, function(p, w) {
        w = parseInt(w, 10);
        var name = 'GF(2^' + w + ')';

        console.log(name, p.toString(16), p.toString(8), p.toString(2));

        if (w > (process.env.GF_TEST_MAX_W || 8)) {
            it.skip(name, function() {});
            return;
        }

        it(name, function(done) {

            this.timeout(1000000);
            console.log(' ');
            console.log('******', w, '******');
            var gf = new GF(w);

            Q.fcall(function() {
                    // test field with modulo calculations
                    console.log(' ');
                    console.log(' -- MODULO --');
                    return run_steps(gf);
                })
                .then(function() {
                    // test field with log tables if tables are not too big (max w=24)
                    if (!gf.init_log_table()) return;
                    console.log(' ');
                    console.log(' -- LOG --');
                    return run_steps(gf);
                })
                .nodeify(done);
        });
    });


    function run_steps(gf, state) {
        state = state || {
            a: 0,
            b: 0,
            a_inverse: 0,
            count: 0,
            start_time: Date.now(),
            report_seconds: 0,
        };
        var done = run_step(gf, state, 10000000);

        // report progress
        var seconds = (Date.now() - state.start_time) / 1000;
        if (done || seconds >= state.report_seconds + 1) {
            state.report_seconds = seconds;
            var speed = state.count / seconds;
            var completed = state.a * 100 / gf.max;
            console.log(' ... completed', completed.toFixed(2), '%',
                'speed', speed.toFixed(0), 'mult/sec');
            // don't run too long for big fields
            if (seconds >= (process.env.GF_TEST_MAX_TIME || 1)) {
                done = true;
            }
        }

        return done ? true : Q.fcall(run_steps, gf, state);
    }


    function run_step(gf, state, cycles) {
        // make vars local for performance
        var a = state.a;
        var b = state.b;
        var a_inverse = state.a_inverse;
        var count = 0;
        var done = false;

        for (var i = 0; i < cycles; ++i) {

            // check validity of result
            var result = gf.mult(a, b);
            count += 1;
            if (typeof(result) !== 'number' || result > gf.max || result < 0) {
                throw new Error('bad result not in range ' +
                    a.toString(2) + ' * ' + b.toString(2) +
                    ' = ' + (result && result.toString(2)));
            }

            // checking inverse
            if (result === 1) {
                if (!a_inverse) {
                    a_inverse = b;
                } else if (a_inverse !== b) {
                    throw new Error('inverse already found for ' +
                        a.toString(2) + ' ' + a_inverse.toString(2));
                }
            }

            // checking field commutativity - a*b = b*a
            var result2 = gf.mult(b, a);
            count += 1;
            if (result !== result2) {
                throw new Error('not commutative ' +
                    a.toString(2) + ' * ' + b.toString(2) +
                    ' = ' + result.toString(2) + ' or ' + result2.toString(2));
            }

            if (b === gf.max) {
                if (a && !a_inverse) {
                    throw new Error('inverse not found for ' + a.toString(2));
                }
                if (a === gf.max) {
                    done = true;
                    break;
                }
                a += 1;
                a_inverse = 0;
                b = 0;
            } else {
                b += 1;
            }
        }

        state.a = a;
        state.b = b;
        state.a_inverse = a_inverse;
        state.count += count;

        return done;
    }


});
