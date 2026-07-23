/* Copyright (C) 2026 NooBaa */
/* eslint max-lines-per-function: ['error', 700] */

'use strict';

const config = require('../../../../config');
const CONSTANTS = require('../../../common/constants');
const SensitiveString = require('../../../util/sensitive_string');
const system_utils = require('../../../server/utils/system_utils');
const { MDStore } = require('../../../server/object_services/md_store');
const object_server = require('../../../server/object_services/object_server');

describe('object_server - delete_multiple_objects', () => {

    let mock_req;
    let mdstore_instance_stub;
    let delete_objects_by_keys_stub;
    let alloc_object_version_seq_stub;
    let alloc_next_n_object_version_seq_stub;

    beforeEach(() => {
        mdstore_instance_stub = {
            delete_objects_by_keys: jest.fn(),
            alloc_object_version_seq: jest.fn(),
            alloc_next_n_object_version_seq: jest.fn(),
            make_md_id: jest.fn(),
            get_object_version_id: jest.fn().mockReturnValue('v123')
        };

        jest.spyOn(MDStore, 'instance').mockReturnValue(mdstore_instance_stub);

        jest.spyOn(system_utils, 'system_in_maintenance').mockReturnValue(false);

        delete_objects_by_keys_stub = mdstore_instance_stub.delete_objects_by_keys;

        alloc_object_version_seq_stub = mdstore_instance_stub.alloc_object_version_seq;

        alloc_next_n_object_version_seq_stub = mdstore_instance_stub.alloc_next_n_object_version_seq;

        mock_req = {
            system: {
                _id: 'system_id_123',
                buckets_by_name: {
                    'test-bucket': {
                        _id: 'bucket_id_123',
                        name: 'test-bucket',
                        versioning: CONSTANTS.S3.VERSIONING.DISABLED
                    }
                }
            },
            rpc_params: {
                bucket: new SensitiveString('test-bucket'),
                objects: []
            },
            bucket: null
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Non-versioned bucket (VERSIONING.DISABLED)', () => {

        test('should successfully delete multiple objects', async () => {
            const objects = [
                { key: 'file1.txt' },
                { key: 'file2.txt' },
                { key: 'file3.txt' }
            ];

            mock_req.rpc_params.objects = objects;

            const deleted_objs = [
                { data: { key: 'file1.txt', _id: 'obj1' } },
                { data: { key: 'file2.txt', _id: 'obj2' } },
                { data: { key: 'file3.txt', _id: 'obj3' } }
            ];

            delete_objects_by_keys_stub.mockResolvedValue(deleted_objs);

            alloc_next_n_object_version_seq_stub
                .mockResolvedValue({
                    start: 1,
                    end: 3
                });

            const results = await object_server.delete_multiple_objects(mock_req);

            expect(results).toHaveLength(3);

            expect(results[0]).toHaveProperty('seq');
            expect(results[1]).toHaveProperty('seq');
            expect(results[2]).toHaveProperty('seq');

            expect(delete_objects_by_keys_stub).toHaveBeenCalledTimes(1);
        });

        test('should handle duplicate keys in request', async () => {
            const objects = [
                { key: 'file1.txt' },
                { key: 'file1.txt' },
                { key: 'file2.txt' }
            ];

            mock_req.rpc_params.objects = objects;

            const deleted_objs = [
                { data: { key: 'file1.txt', _id: 'obj1' } },
                { data: { key: 'file2.txt', _id: 'obj2' } }
            ];

            delete_objects_by_keys_stub.mockResolvedValue(deleted_objs);

            alloc_next_n_object_version_seq_stub
                .mockResolvedValue({
                    start: 1,
                    end: 3
                });

            const results = await object_server.delete_multiple_objects(mock_req);

            expect(results).toHaveLength(3);

            expect(results[0]).toHaveProperty('seq');
            expect(results[1]).toHaveProperty('seq');
            expect(results[2]).toHaveProperty('seq');
        });

        test('should filter out non-null version_id for non-versioned bucket', async () => {
            const objects = [
                { key: 'file1.txt', version_id: 'v123' },
                { key: 'file2.txt' },
                { key: 'file3.txt', version_id: CONSTANTS.S3.VERSION_NULL }
            ];

            mock_req.rpc_params.objects = objects;

            const deleted_objs = [
                { data: { key: 'file2.txt', _id: 'obj2' } },
                { data: { key: 'file3.txt', _id: 'obj3' } }
            ];

            delete_objects_by_keys_stub.mockResolvedValue(deleted_objs);

            alloc_next_n_object_version_seq_stub
                .mockResolvedValue({
                    start: 1,
                    end: 2
                });

            alloc_object_version_seq_stub.mockResolvedValue(100);

            const results = await object_server.delete_multiple_objects(mock_req);

            expect(results).toHaveLength(3);

            expect(results[0]).toHaveProperty('seq');
            expect(results[1]).toHaveProperty('seq');
            expect(results[2]).toHaveProperty('seq');
        });

        test('should handle objects not found in DB', async () => {
            const objects = [
                { key: 'file1.txt' },
                { key: 'file2.txt' },
                { key: 'file3.txt' }
            ];

            mock_req.rpc_params.objects = objects;

            const deleted_objs = [
                { data: { key: 'file1.txt', _id: 'obj1' } },
                { data: { key: 'file3.txt', _id: 'obj3' } }
            ];

            delete_objects_by_keys_stub.mockResolvedValue(deleted_objs);

            alloc_next_n_object_version_seq_stub
                .mockResolvedValue({
                    start: 1,
                    end: 2
                });

            alloc_object_version_seq_stub.mockResolvedValue(100);

            const results = await object_server.delete_multiple_objects(mock_req);

            expect(results).toHaveLength(3);

            expect(results[0]).toHaveProperty('seq');
            expect(results[1]).toHaveProperty('seq');
            expect(results[2]).toHaveProperty('seq');

            expect(alloc_object_version_seq_stub).toHaveBeenCalledTimes(1);
        });

        test('should handle batch processing for large number of objects', async () => {
            const batch_size =
                config.DELETE_OBJECTS_BATCH_SIZE || 100;

            const num_objects =
                batch_size * 2 + 50;

            const objects = Array.from(
                { length: num_objects },
                (_, i) => ({
                    key: `file${i}.txt`
                })
            );

            mock_req.rpc_params.objects = objects;

            const deleted_objs = objects.map((obj, i) => ({
                data: {
                    key: obj.key,
                    _id: `obj${i}`
                }
            }));

            delete_objects_by_keys_stub
                .mockResolvedValueOnce(
                    deleted_objs.slice(0, batch_size)
                )
                .mockResolvedValueOnce(
                    deleted_objs.slice(
                        batch_size,
                        batch_size * 2
                    )
                )
                .mockResolvedValueOnce(
                    deleted_objs.slice(batch_size * 2)
                );

            alloc_next_n_object_version_seq_stub
                .mockResolvedValue({
                    start: 1,
                    end: num_objects
                });

            const results = await object_server.delete_multiple_objects(mock_req);

            expect(results).toHaveLength(num_objects);

            expect(delete_objects_by_keys_stub).toHaveBeenCalledTimes(3);
        });

        test('should handle errors during delete and return InternalError', async () => {
            const objects = [
                { key: 'file1.txt' },
                { key: 'file2.txt' }
            ];

            mock_req.rpc_params.objects = objects;

            delete_objects_by_keys_stub
                .mockRejectedValue(
                    new Error('Database connection failed')
                );

            const results = await object_server.delete_multiple_objects(mock_req);

            expect(results).toHaveLength(2);

            expect(results[0]).toHaveProperty(
                'err_code',
                'InternalError'
            );

            expect(results[0]).toHaveProperty(
                'err_message',
                'Database connection failed'
            );

            expect(results[1]).toHaveProperty(
                'err_code',
                'InternalError'
            );
        });

        test('should handle empty objects array', async () => {
            mock_req.rpc_params.objects = [];

            const results =
                await object_server.delete_multiple_objects(mock_req);

            expect(results).toHaveLength(0);

            expect(delete_objects_by_keys_stub).not.toHaveBeenCalled();
        });
    });
});

describe('object_server - update_bulk_delete_results', () => {

    let mdstore_instance_stub;
    let alloc_next_n_object_version_seq_stub;
    let alloc_object_version_seq_stub;

    beforeEach(() => {
        mdstore_instance_stub = {
            alloc_next_n_object_version_seq: jest.fn(),
            alloc_object_version_seq: jest.fn(),
            get_object_version_id: jest.fn()
                .mockReturnValue('v123')
        };

        jest.spyOn(MDStore, 'instance')
            .mockReturnValue(mdstore_instance_stub);

        jest.spyOn(system_utils, 'system_in_maintenance')
            .mockReturnValue(false);

        alloc_next_n_object_version_seq_stub = mdstore_instance_stub.alloc_next_n_object_version_seq;

        alloc_object_version_seq_stub = mdstore_instance_stub.alloc_object_version_seq;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('should update results with sequential version numbers', async () => {

        const objects = [
            { data: { key: 'file1.txt', _id: 'obj1' } },
            { data: { key: 'file2.txt', _id: 'obj2' } },
            { data: { key: 'file3.txt', _id: 'obj3' } }
        ];

        const object_index_map = {
            'file1.txt': [0],
            'file2.txt': [1],
            'file3.txt': [2]
        };

        const results = new Array(3);

        alloc_next_n_object_version_seq_stub
            .mockResolvedValue({
                start: 100,
                end: 102
            });

        await object_server.__testing
            .update_bulk_delete_results(
                objects,
                object_index_map,
                results,
                3
            );

        expect(results[0]).toHaveProperty('seq', 100);

        expect(results[0])
            .toHaveProperty(
                'deleted_version_id',
                'v123'
            );

        expect(results[1]).toHaveProperty('seq', 101);

        expect(results[2]).toHaveProperty('seq', 102);

        expect(alloc_next_n_object_version_seq_stub).toHaveBeenCalledTimes(1);

        expect(alloc_next_n_object_version_seq_stub).toHaveBeenCalledWith(3);
    });

    test('should handle duplicate keys with multiple indices', async () => {
        const objects = [
            { data: { key: 'file1.txt', _id: 'obj1' } }
        ];

        const object_index_map = {
            'file1.txt': [0, 1, 2]
        };

        const results = new Array(3);

        alloc_next_n_object_version_seq_stub
            .mockResolvedValue({
                start: 100,
                end: 102
            });

        await object_server.__testing
            .update_bulk_delete_results(
                objects,
                object_index_map,
                results,
                3
            );

        expect(results[0]).toHaveProperty('seq', 100);

        expect(results[1]).toHaveProperty('seq', 101);

        expect(results[2]).toHaveProperty('seq', 102);

        expect(results[0])
            .toHaveProperty(
                'deleted_version_id',
                'v123'
            );

        expect(results[1])
            .toHaveProperty(
                'deleted_version_id',
                'v123'
            );

        expect(results[2])
            .toHaveProperty(
                'deleted_version_id',
                'v123'
            );
    });

    test('should allocate individual seq when exceeding allocated range', async () => {
        const objects = [
            { data: { key: 'file1.txt', _id: 'obj1' } },
            { data: { key: 'file2.txt', _id: 'obj2' } }
        ];

        const object_index_map = {
            'file1.txt': [0],
            'file2.txt': [1]
        };

        const results = new Array(2);

        alloc_next_n_object_version_seq_stub
            .mockResolvedValue({
                start: 100,
                end: 100
            });

        alloc_object_version_seq_stub.mockResolvedValue(200);

        await object_server.__testing
            .update_bulk_delete_results(
                objects,
                object_index_map,
                results,
                2
            );

        expect(results[0]).toHaveProperty('seq', 100);

        expect(results[1]).toHaveProperty('seq', 200);

        expect(alloc_object_version_seq_stub).toHaveBeenCalledTimes(1);
    });

    test('should handle empty objects array', async () => {
        await object_server.__testing
            .update_bulk_delete_results(
                [],
                {},
                [],
                0
            );

        expect(alloc_next_n_object_version_seq_stub).not.toHaveBeenCalled();

        expect(alloc_object_version_seq_stub).not.toHaveBeenCalled();
    });

    test('should handle objects with delete_marker flag', async () => {
        const objects = [
            {
                data: {
                    key: 'file1.txt',
                    _id: 'obj1',
                    delete_marker: true
                }
            }
        ];

        const object_index_map = {
            'file1.txt': [0]
        };

        const results = new Array(1);

        alloc_next_n_object_version_seq_stub
            .mockResolvedValue({
                start: 100,
                end: 100
            });

        await object_server.__testing
            .update_bulk_delete_results(
                objects,
                object_index_map,
                results,
                1
            );

        expect(results[0]).toHaveProperty('seq', 100);

        expect(results[0])
            .toHaveProperty(
                'deleted_delete_marker',
                true
            );
    });

    test('should process multiple objects with mixed indices', async () => {
        const objects = [
            { data: { key: 'file1.txt', _id: 'obj1' } },
            { data: { key: 'file2.txt', _id: 'obj2' } }
        ];

        const object_index_map = {
            'file1.txt': [0, 2],
            'file2.txt': [1, 3]
        };

        const results = new Array(4);

        alloc_next_n_object_version_seq_stub
            .mockResolvedValue({
                start: 100,
                end: 103
            });

        await object_server.__testing
            .update_bulk_delete_results(
                objects,
                object_index_map,
                results,
                4
            );

        expect(results[0]).toHaveProperty('seq', 100);

        expect(results[1]).toHaveProperty('seq', 102);

        expect(results[2]).toHaveProperty('seq', 101);

        expect(results[3]).toHaveProperty('seq', 103);
    });
});

describe('object_server._can_bypass_governance', () => {
    const { _can_bypass_governance } = object_server.__testing;

    it('returns the RPC bypass_governance flag', () => {
        expect(_can_bypass_governance({ rpc_params: { bypass_governance: true } })).toBe(true);
        expect(_can_bypass_governance({ rpc_params: { bypass_governance: false } })).toBe(false);
        expect(_can_bypass_governance({ rpc_params: {} })).toBe(false);
    });
});
