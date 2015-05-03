// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
// var assert = require('assert');
var Poly = require('../util/poly');


describe('poly', function() {

    var test_degree = parseInt(process.env.POLY_TEST_DEGREE, 10);
    var max_degree = parseInt(process.env.POLY_TEST_MAX_DEGREE, 10) || 8;

    _.each(Poly.PRIMITIVES, function(degrees, degree) {
        degree = parseInt(degree, 10);

        var skip = false;
        if (test_degree) {
            skip = (degree !== test_degree);
        } else {
            skip = (degree > max_degree);
        }
        var p = new Poly(degrees);
        if (skip) {
            // it.skip(p.toString(), function() {});
            return;
        }

        it(p.toString(), function(done) {

            this.timeout(1000000);
            console.log(' ');
            console.log('******', degree, '******');

            Q.fcall(function() {
                    return run_steps(p);
                })
                .nodeify(done);
        });
    });


    function run_steps(p, state) {
        state = state || {
            a: 0,
            b: p.max,
            a_inverse: 0,
            count: 0,
            start_time: Date.now(),
            report_seconds: 0,
        };
        var done = run_step(p, state, 10000000);

        // report progress
        var seconds = (Date.now() - state.start_time) / 1000;
        if (done || seconds >= state.report_seconds + 1) {
            state.report_seconds = seconds;
            var speed = state.count / seconds;
            var completed = state.a * 100 / p.max;
            console.log(' ... completed', completed.toFixed(2), '%',
                'speed', speed.toFixed(0), 'mult/sec');
            // don't run too long for big fields
            if (seconds >= (process.env.POLY_TEST_MAX_TIME || 1)) {
                done = true;
            }
        }

        return done ? true : Q.fcall(run_steps, p, state);
    }


    function run_step(p, state, cycles) {
        // make vars local for performance
        var a = state.a;
        var b = state.b;
        var a_inverse = state.a_inverse;
        var count = 0;
        var done = false;

        for (var i = 0; i < cycles; ++i) {

            // check validity of result
            var result = p.mult_mod(a, b);
            count += 1;
            if (typeof(result) !== 'number' || result > p.max || result < 0) {
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
            var result2 = p.mult_mod(b, a);
            count += 1;
            if (result !== result2) {
                throw new Error('not commutative ' +
                    a.toString(2) + ' * ' + b.toString(2) +
                    ' = ' + result.toString(2) + ' or ' + result2.toString(2));
            }

            if (b === 0) {
                if (a && !a_inverse) {
                    throw new Error('inverse not found for ' + a.toString(2));
                }
                if (a === p.max) {
                    done = true;
                    break;
                }
                a += 1;
                a_inverse = 0;
                b = p.max;
            } else {
                b -= 1;
            }
        }

        state.a = a;
        state.b = b;
        state.a_inverse = a_inverse;
        state.count += count;

        return done;
    }


});
