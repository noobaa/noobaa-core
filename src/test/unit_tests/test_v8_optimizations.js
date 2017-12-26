/* Copyright (C) 2016 NooBaa */
'use strict';

// NOTE: This test requires to run with `node --allow-natives-syntax` !!!
//
// Read this for background - https://github.com/petkaantonov/bluebird/wiki/Optimization-killers
// More details here - https://github.com/vhf/v8-bailout-reasons

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const stream = require('stream');

const P = require('../../util/promise');
const FrameStream = require('../../util/frame_stream');
const buffer_utils = require('../../util/buffer_utils');

const OPTIMIZED = 'OPTIMIZED';
const NOT_OPTIMIZED = 'NOT_OPTIMIZED';
const ALWAYS_OPTIMIZED = 'ALWAYS_OPTIMIZED';
const NEVER_OPTIMIZED = 'NEVER_OPTIMIZED';
const MAYBE_DEOPTIMIZED = 'MAYBE_DEOPTIMIZED';
const TURBOFAN_OPTIMIZED = 'TURBOFAN_OPTIMIZED';
const BASE = 0;
const OPT_CODES = {
    [BASE + 1]: OPTIMIZED,
    [BASE + 2]: NOT_OPTIMIZED,
    [BASE + 3]: ALWAYS_OPTIMIZED,
    [BASE + 4]: NEVER_OPTIMIZED,
    [BASE + 6]: MAYBE_DEOPTIMIZED,
    [BASE + 7]: TURBOFAN_OPTIMIZED,
};

function get_opt_status(func, caller) {
    // 2 calls are needed to go from uninitialized -> pre-monomorphic -> monomorphic
    caller = caller || func;
    for (let i = 0; i < 10; ++i) caller();
    eval('%OptimizeFunctionOnNextCall(func)'); // eslint-disable-line no-eval
    for (let i = 0; i < 10; ++i) caller();
    const code = eval('%GetOptimizationStatus(func)'); // eslint-disable-line no-eval
    return OPT_CODES[code];
}

function is_optimized(status) {
    return status === OPTIMIZED || status === ALWAYS_OPTIMIZED || status === TURBOFAN_OPTIMIZED;
}

function assert_optimized(func, caller) {
    const status = get_opt_status(func, caller);
    assert.ok(is_optimized(status), `${func.name} expected to be optimized but is ${status} instead`);
}

// function assert_not_optimized(func, caller) {
//     const status = get_opt_status(func, caller);
//     assert.ok(!is_optimized(status), `${func.name} expected to be not-optimized but is ${status} instead`);
// }

// TODO GUY skipping because the optimization status is different on node.js v8
mocha.describe.skip('v8 optimizations', function() {

    mocha.it('should optimize buffer_utils.join', function() {
        assert_optimized(buffer_utils.join,
            () => buffer_utils.join([])
        );
        assert_optimized(buffer_utils.join,
            () => buffer_utils.join([
                Buffer.alloc(10, 'a'),
                Buffer.alloc(10, 'b'),
                Buffer.alloc(10, 'c'),
                Buffer.alloc(10, 'd'),
            ])
        );
    });

    mocha.it('should optimize buffer_utils.extract', function() {
        assert_optimized(buffer_utils.extract,
            () => buffer_utils.extract([
                Buffer.alloc(10, 'a'),
                Buffer.alloc(10, 'b'),
                Buffer.alloc(10, 'c'),
                Buffer.alloc(10, 'd'),
            ], 23)
        );
    });

    mocha.it('should optimize P.defer', function() {
        assert_optimized(P.defer);
    });

    mocha.it('should optimize P.resolve', function() {
        assert_optimized(P.resolve);
    });

    mocha.it('should optimize P.then', function() {
        assert_optimized(P.prototype.then,
            () => P.resolve().then(_.noop)
        );
    });

    mocha.it('should optimize P.catch', function() {
        assert_optimized(P.prototype.catch,
            () => P.resolve().catch(_.noop)
        );
    });

    mocha.it('should optimize frame_stream', function() {
        const s = new FrameStream(new stream.Duplex({
            read: () => { /* noop */ },
            write: () => { /* noop */ }
        }));
        assert_optimized(FrameStream.prototype._send_message,
            () => s._send_message([Buffer.from('abcd'), Buffer.from('efg')])
        );
        let seq = s._recv_seq || 0;
        assert_optimized(FrameStream.prototype._on_data,
            () => {
                const buf = Buffer.alloc(s._header_len);
                buf.write(s._magic);
                buf.writeUInt16BE(seq, s._magic_len);
                s._on_data(buf);
                seq += 1;
            }
        );
    });

});
