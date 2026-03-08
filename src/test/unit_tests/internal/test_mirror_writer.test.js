/* Copyright (C) 2016 NooBaa */
'use strict';

jest.mock('../../../../config', () => ({
    MIRROR_WRITER_EMPTY_DELAY: 30000,
    MIRROR_WRITER_BATCH_DELAY: 50,
    MIRROR_WRITER_ERROR_DELAY: 3000,
    MIRROR_WRITER_BATCH_SIZE: 10,
    MIRROR_WRITER_MARKER_STORE_PERIOD: 10 * 60000
}));

jest.mock('../../../util/debug_module', () => () => ({
    set_module_level: () => undefined,
    log0: () => undefined,
    log1: () => undefined,
    log2: () => undefined,
    warn: () => undefined,
    error: () => undefined
}));

jest.mock('../../../server/system_services/system_store', () => ({
    get_instance: () => ({
        is_finished_initial_load: true,
        data: {
            systems: [{ _id: 'sys1' }],
            buckets: []
        },
        make_changes: jest.fn().mockResolvedValue(undefined)
    })
}));

jest.mock('../../../server/object_services/md_store', () => ({
    MDStore: {
        instance: () => ({
            iterate_all_chunks_in_buckets: jest.fn(),
            make_md_id: id => id
        })
    }
}));

jest.mock('../../../server/bg_services/bucket_chunks_builder', () => ({
    BucketChunksBuilder: jest.fn().mockImplementation(() => ({
        run_batch: jest.fn(),
        get_chunks_range: jest.fn(),
        get_start_marker: jest.fn()
    }))
}));

const _ = require('lodash');
const { ObjectId } = require('mongodb');

const { MirrorWriter } = require('../../../server/bg_services/mirror_writer');
const config = require('../../../../config');

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
    const mw = new MirrorWriter(params || { name: 'mw', client: {} });
    mw._get_mirrored_buckets = () => [{ name: 'bucket1', _id: '1' }, { name: 'bucket2', _id: '2' }];
    mw._can_run = () => true;
    mw._update_markers_in_system_store = _.noop;
    if (chunks_builder) {
        if (retry_chunks_builder) {
            mw._get_bucket_chunks_builder = ({ end_marker } = {}) => {
                if (end_marker) {
                    return retry_chunks_builder;
                }
                return chunks_builder;
            };
        } else {
            mw._get_bucket_chunks_builder = () => chunks_builder;
        }
    }
    return mw;
}

describe('mirror_writer', () => {

    describe('run_batch', () => {

        it('should return empty delay when nothing to do', async () => {
            const mw = get_mirror_writer({ chunks_builder: empty_chunks_builder });
            const delay = await mw.run_batch();
            expect(delay).toBe(config.MIRROR_WRITER_EMPTY_DELAY);
        });

        it('should return batch delay after successful run', async () => {
            const mw = get_mirror_writer({ chunks_builder: successful_chunks_builder });
            const delay = await mw.run_batch();
            expect(delay).toBe(config.MIRROR_WRITER_BATCH_DELAY);
        });

        it('should return error delay after unsuccessful run', async () => {
            const mw = get_mirror_writer({ chunks_builder: unsuccessful_chunks_builder });
            const delay = await mw.run_batch();
            expect(delay).toBe(config.MIRROR_WRITER_ERROR_DELAY);
        });

        it('should return error delay after bucket_chunks_builder throws', async () => {
            const mw = get_mirror_writer({ chunks_builder: throwing_chunks_builder });
            const delay = await mw.run_batch();
            expect(delay).toBe(config.MIRROR_WRITER_ERROR_DELAY);
        });

        it('should get a retry scanner with the failed range after failure', async () => {
            const mw = get_mirror_writer();
            const get_builder = jest.fn()
                .mockReturnValueOnce(unsuccessful_chunks_builder)
                .mockReturnValueOnce(successful_chunks_builder);
            mw._get_bucket_chunks_builder = get_builder;
            const delay1 = await mw.run_batch();
            expect(delay1).toBe(config.MIRROR_WRITER_ERROR_DELAY);
            await mw.run_batch();
            expect(get_builder).toHaveBeenCalledTimes(2);
            const second_call_arg = get_builder.mock.calls[1][0];
            expect(second_call_arg.start_marker.toString()).toBe(test_chunks[0].toString());
            expect(second_call_arg.end_marker.toString()).toBe(test_chunks[test_chunks.length - 1].toString());
        });

        it('should not get retry scanner if no errors', async () => {
            const mw = get_mirror_writer();
            const get_builder = jest.fn().mockReturnValueOnce(successful_chunks_builder);
            mw._get_bucket_chunks_builder = get_builder;
            const delay1 = await mw.run_batch();
            expect(delay1).toBe(config.MIRROR_WRITER_BATCH_DELAY);
            await mw.run_batch();
            expect(get_builder).toHaveBeenCalledTimes(1);
        });

        it('should store only start marker when there are no errors', async () => {
            const mw = get_mirror_writer({ chunks_builder: successful_chunks_builder });
            mw._should_store_markers = () => true;
            const update_markers = jest.fn();
            mw._update_markers_in_system_store = update_markers;
            await mw.run_batch();
            expect(update_markers).toHaveBeenCalledWith({ start_marker: test_chunks[test_chunks.length - 1] });
        });

        it('should return undefined when _can_run is false', async () => {
            const mw = get_mirror_writer({ chunks_builder: successful_chunks_builder });
            mw._can_run = () => false;
            const delay = await mw.run_batch();
            expect(delay).toBeUndefined();
        });

        it('should return empty delay when no mirrored buckets', async () => {
            const mw = get_mirror_writer({ chunks_builder: empty_chunks_builder });
            mw._get_mirrored_buckets = () => [];
            const delay = await mw.run_batch();
            expect(delay).toBe(config.MIRROR_WRITER_EMPTY_DELAY);
        });

        it('should return error delay when empty scan batch and retry has errors', async () => {
            const main_builder_first_run = {
                ...default_chunks_builder,
                run_batch: jest.fn()
                    .mockResolvedValueOnce({ successful: false, chunk_ids: test_chunks })
                    .mockResolvedValueOnce({ successful: true, chunk_ids: [] })
            };
            const retry_fail_builder = {
                ...default_chunks_builder,
                run_batch: () => ({ successful: false, chunk_ids: test_chunks })
            };
            const mw = get_mirror_writer();
            const get_builder = jest.fn()
                .mockReturnValueOnce(main_builder_first_run)
                .mockReturnValueOnce(retry_fail_builder);
            mw._get_bucket_chunks_builder = get_builder;
            const delay1 = await mw.run_batch();
            expect(delay1).toBe(config.MIRROR_WRITER_ERROR_DELAY);
            const delay2 = await mw.run_batch();
            expect(delay2).toBe(config.MIRROR_WRITER_ERROR_DELAY);
        });

        it('should store retry_range when retry scanner exists and _should_store_markers is true', async () => {
            const retry_range = { start: test_chunks[0].toString(), end: test_chunks[test_chunks.length - 1].toString() };
            const retry_scanner_builder = {
                ...successful_chunks_builder,
                get_chunks_range: () => retry_range
            };
            const mw = get_mirror_writer();
            const get_builder = jest.fn()
                .mockReturnValueOnce(unsuccessful_chunks_builder)
                .mockReturnValueOnce(retry_scanner_builder);
            mw._get_bucket_chunks_builder = get_builder;
            mw._should_store_markers = () => true;
            const update_markers = jest.fn().mockResolvedValue(undefined);
            mw._update_markers_in_system_store = update_markers;
            await mw.run_batch();
            expect(update_markers).toHaveBeenCalled();
            const call_arg = update_markers.mock.calls[0][0];
            expect(call_arg.start_marker).toBeDefined();
            expect(call_arg.retry_range).toBeDefined();
            expect(call_arg.retry_range.start.toString()).toBe(test_chunks[0].toString());
            expect(call_arg.retry_range.end.toString()).toBe(test_chunks[test_chunks.length - 1].toString());
        });

    });

});
