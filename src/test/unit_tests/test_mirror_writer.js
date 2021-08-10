/* Copyright (C) 2016 NooBaa */
'use strict';


// const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const sinon = require('sinon');
const _ = require('lodash');
const { ObjectId } = require('mongodb');

const { MirrorWriter } = require('../../server/bg_services/mirror_writer');
const config = require('../../../config');

const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
// argv.verbose = true;
if (argv.verbose) {
    dbg.set_module_level(5, 'core');
} else {
    // disable dbg messages by default
    dbg.set_module_level(-1, 'core');
}


const test_chunks = _.times(3, () => new ObjectId());

const default_chunks_builder = {
    run_batch: () => ({
        successful: true,
        chunk_ids: [],
        done: true
    }),
    get_chunks_range: _.noop,
    get_start_marker: () => test_chunks[test_chunks.length - 1]
};

const empty_chunks_builder = _.defaults({
    run_batch: () => ({
        successful: true,
        chunk_ids: [],
        done: true
    })
}, default_chunks_builder);

const successful_chunks_builder = _.defaults({
    run_batch: () => ({
        successful: true,
        chunk_ids: test_chunks
    }),
}, default_chunks_builder);

const unsuccessful_chunks_builder = _.defaults({
    run_batch: () => ({
        successful: false,
        chunk_ids: test_chunks
    })
}, default_chunks_builder);

const throwing_chunks_builder = _.defaults({
    run_batch: () => {
        throw new Error('TEST_ERROR');
    }
}, default_chunks_builder);


function get_mirror_writer({ params, chunks_builder, retry_chunks_builder } = {}) {
    const mw = new MirrorWriter(params || { name: 'mw', client: {}, });
    // stub some of the internal functions
    mw._get_mirrored_buckets = () => [{ name: 'bucket1', _id: '1' }, { name: 'bucket2', _id: '2' }];
    mw._can_run = () => true;
    mw._update_markers_in_system_store = _.noop;
    if (chunks_builder) {
        if (retry_chunks_builder) {
            // return differnet builder for retry. retry is identified by mirror_writer sending end_marker
            mw._get_bucket_chunks_builder = ({ end_marker } = {}) => {
                if (end_marker) {
                    return retry_chunks_builder;
                } else {
                    return chunks_builder;
                }
            };
        } else {
            // return same builder for both scan and retry
            mw._get_bucket_chunks_builder = () => chunks_builder;
        }
    }
    return mw;
}


mocha.describe('mirror_writer', function() {

    mocha.describe('run_batch', function() {

        mocha.it('should return empty delay when nothing to do', async function() {
            const mw = get_mirror_writer({ chunks_builder: empty_chunks_builder });
            const delay = await mw.run_batch();
            assert.strictEqual(delay, config.MIRROR_WRITER_EMPTY_DELAY);
        });

        mocha.it('should return batch delay after successful run', async function() {
            const mw = get_mirror_writer({ chunks_builder: successful_chunks_builder });
            const delay = await mw.run_batch();
            assert.strictEqual(delay, config.MIRROR_WRITER_BATCH_DELAY);
        });

        mocha.it('should return error delay after unsuccessful run', async function() {
            const mw = get_mirror_writer({ chunks_builder: unsuccessful_chunks_builder });
            const delay = await mw.run_batch();
            assert.strictEqual(delay, config.MIRROR_WRITER_ERROR_DELAY);
        });

        mocha.it('should return error delay after bucket_chunks_builder throws', async function() {
            const mw = get_mirror_writer({ chunks_builder: throwing_chunks_builder });
            const delay = await mw.run_batch();
            assert.strictEqual(delay, config.MIRROR_WRITER_ERROR_DELAY);
        });

        mocha.it('should get a retry scanner with the failed range after failure', async function() {
            const mw = get_mirror_writer();
            const get_builder = sinon.stub();
            get_builder.onFirstCall().returns(unsuccessful_chunks_builder)
                .onSecondCall().returns(successful_chunks_builder);
            mw._get_bucket_chunks_builder = get_builder;
            const delay1 = await mw.run_batch();
            assert.strictEqual(delay1, config.MIRROR_WRITER_ERROR_DELAY);
            await mw.run_batch();
            assert.strictEqual(get_builder.callCount, 2);
            // first call is the main mirror_scanner, second is retry scanner due to errors
            assert(get_builder.secondCall.calledWithExactly({
                start_marker: test_chunks[0],
                end_marker: test_chunks[test_chunks.length - 1]
            }));
        });

        mocha.it('should not get retry scanner if no errors', async function() {
            const mw = get_mirror_writer();
            const get_builder = sinon.stub();
            get_builder.onFirstCall().returns(successful_chunks_builder);
            mw._get_bucket_chunks_builder = get_builder;
            const delay1 = await mw.run_batch();
            assert.strictEqual(delay1, config.MIRROR_WRITER_BATCH_DELAY);
            await mw.run_batch();
            // first call is the main mirror_scanner, second is retry scanner due to errors
            assert(get_builder.calledOnce);
        });

        mocha.it('should store only start marker when there are no errors', async function() {
            const mw = get_mirror_writer({ chunks_builder: successful_chunks_builder });
            mw._should_store_markers = () => true;
            mw._update_markers_in_system_store = sinon.spy();
            await mw.run_batch();
            assert(mw._update_markers_in_system_store.calledWithExactly({ start_marker: test_chunks[test_chunks.length - 1] }));
        });

    });

});
