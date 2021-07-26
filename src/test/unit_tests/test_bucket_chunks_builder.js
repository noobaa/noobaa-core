/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const sinon = require('sinon');
const argv = require('minimist')(process.argv);

const { BucketChunksBuilder } = require('../../server/bg_services/bucket_chunks_builder');
const dbg = require('../../util/debug_module')(__filename);

// argv.verbose = true;
if (argv.verbose) {
    dbg.set_module_level(5, 'core');
} else {
    // disable dbg messages by default
    dbg.set_module_level(-1, 'core');
}


mocha.describe('bucket_chunks_builder', function() {

    mocha.describe('run_batch', function() {

        mocha.it('should return empty chunk_ids and success on no\\empty buckets', async function() {
            const iterate_chunks_func = sinon.spy();
            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // no arguments
            const res1 = await builder.run_batch();
            assert(iterate_chunks_func.notCalled);
            assert(build_chunks_func.notCalled);
            assert.deepEqual(res1, { successful: true, chunk_ids: [] });
            // empty array
            const res2 = await builder.run_batch([]);
            assert(iterate_chunks_func.notCalled);
            assert(build_chunks_func.notCalled);
            assert.deepEqual(res2, { successful: true, chunk_ids: [] });
        });

        mocha.it('should return empty chunk_ids and success on empty iteration result', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.returns({ marker: null, chunk_ids: [] });
            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // iterate returns no results
            const res = await builder.run_batch(['bucket1', 'bucket2']);
            assert.strictEqual(iterate_chunks_func.callCount, 1, 'iterate_chunks_func should be called only once');
            assert.strictEqual(build_chunks_func.callCount, 0, 'build_chunks_func should not be called');
            assert.deepEqual(res, { successful: true, chunk_ids: [] });
        });

        mocha.it('should pass (start_marker, end_marker, buckets) in this order', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.returns({ marker: null, chunk_ids: [] });
            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({
                iterate_chunks_func,
                build_chunks_func,
                start_marker: 'start',
                end_marker: 'end'
            });
            // test parmaters order
            await builder.run_batch(['bucket']);
            assert(iterate_chunks_func.calledWithExactly('start', 'end', ['bucket']),
                'iterate_chunks_func should be called with (start_marker, end_marker, buckets) in this order');
        });

        mocha.it('should return empty chunk_ids and success on empty iteration result', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.returns({ marker: null, chunk_ids: [] });
            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // iterate returns no results
            const res = await builder.run_batch(['bucket1', 'bucket2']);
            assert.strictEqual(iterate_chunks_func.callCount, 1, 'iterate_chunks_func should be called only once');
            assert.strictEqual(build_chunks_func.callCount, 0, 'build_chunks_func should not be called');
            assert.deepEqual(res, { successful: true, chunk_ids: [] });
        });


        mocha.it('should not modify marker on empty iteration result if no end_marker', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func
                .onFirstCall()
                .returns({ marker: '4', chunk_ids: ['1', '2', '3', '4'] })
                .onSecondCall()
                .returns({ marker: null, chunk_ids: [] });

            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // iterate returns no results
            await builder.run_batch(['bucket1', 'bucket2']);
            assert.strictEqual(iterate_chunks_func.callCount, 1, 'iterate_chunks_func should be called only once');
            assert.strictEqual(build_chunks_func.callCount, 1, 'build_chunks_func should be called once');
            assert.strictEqual(builder.marker, '4');
            await builder.run_batch(['bucket1', 'bucket2']);
            assert.strictEqual(iterate_chunks_func.callCount, 2, 'iterate_chunks_func should be called twice');
            assert.strictEqual(build_chunks_func.callCount, 1, 'build_chunks_func should be called once');
            assert.strictEqual(builder.marker, '4');
        });

        mocha.it('should return done if end_marker is sent', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.returns({ marker: null, chunk_ids: [] });
            const build_chunks_func = sinon.spy();

            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func, end_marker: 'end' });
            // iterate returns no results. end_marker is sent - should get done:true
            const res = await builder.run_batch(['bucket1', 'bucket2']);
            assert.strictEqual(res.done, true);
            assert(build_chunks_func.notCalled);
        });

        mocha.it('should not return done if end_marker is not sent', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.returns({ marker: null, chunk_ids: [] });
            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // iterate returns no results. no end_marker so not done
            const res = await builder.run_batch(['bucket1', 'bucket2']);
            assert.strictEqual(res.done, undefined);
        });

        mocha.it('should call build_chunks_func with chunk_ids from iterate', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.returns({ marker: 'chunk4', chunk_ids: ['chunk1', 'chunk2', 'chunk3', 'chunk4'] });
            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // iterate returns no results. no end_marker so not done
            await builder.run_batch(['bucket1', 'bucket2']);
            assert(build_chunks_func.calledWithExactly(['chunk1', 'chunk2', 'chunk3', 'chunk4']));
        });

        mocha.it('should return successful chunk_ids on build_chunks_func success', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.returns({ marker: 'chunk4', chunk_ids: ['chunk1', 'chunk2', 'chunk3', 'chunk4'] });
            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // iterate returns no results. no end_marker so not done
            const res = await builder.run_batch(['bucket1', 'bucket2']);
            assert.deepStrictEqual(res, { successful: true, chunk_ids: ['chunk1', 'chunk2', 'chunk3', 'chunk4'] });
        });

        mocha.it('should return chunk_ids with successful:false on build_chunks_func error', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.returns({ marker: 'chunk4', chunk_ids: ['chunk1', 'chunk2', 'chunk3', 'chunk4'] });
            const build_chunks_func = sinon.stub();
            build_chunks_func.throws('TEST_ERROR');
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // iterate returns no results. no end_marker so not done
            const res = await builder.run_batch(['bucket1', 'bucket2']);
            assert.deepStrictEqual(res, { successful: false, chunk_ids: ['chunk1', 'chunk2', 'chunk3', 'chunk4'] });
        });

        mocha.it('should return empty chunk_ids and successful:false iterate_chunks_func error', async function() {
            const iterate_chunks_func = sinon.stub();
            iterate_chunks_func.throws('TEST_ERROR');
            const build_chunks_func = sinon.spy();
            const builder = new BucketChunksBuilder({ iterate_chunks_func, build_chunks_func });
            // iterate returns no results. no end_marker so not done
            const res = await builder.run_batch(['bucket1', 'bucket2']);
            assert.deepStrictEqual(res, { successful: false, chunk_ids: [] });
            assert(build_chunks_func.notCalled);
        });

    });

});
