/* Copyright (C) 2026 NooBaa */

'use strict';

const SensitiveString = require('../../../util/sensitive_string');
const { MDStore } = require('../../../server/object_services/md_store');
const object_server = require('../../../server/object_services/object_server');
const bucket_server = require('../../../server/system_services/bucket_server');
const system_store = require('../../../server/system_services/system_store').get_instance();
const Dispatcher = require('../../../server/notifications/dispatcher');

const BUCKET_ID = '507f1f77bcf86cd799439011';

describe('Object Lock protection for bucket delete / reclaim', () => {

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('delete_multiple_objects_unordered', () => {

        test('throws when bucket has Object Lock protected objects', async () => {
            const mock_req = {
                system: {
                    _id: 'system_id_123',
                    buckets_by_name: {
                        'test-bucket': {
                            _id: BUCKET_ID,
                            name: new SensitiveString('test-bucket'),
                        }
                    }
                },
                rpc_params: {
                    bucket: new SensitiveString('test-bucket'),
                    limit: 1000,
                },
            };

            jest.spyOn(MDStore, 'instance').mockReturnValue({
                has_any_locked_objects_in_bucket: jest.fn().mockResolvedValue(true),
                find_objects: jest.fn(),
                remove_objects_and_unset_latest: jest.fn(),
                has_any_objects_for_bucket: jest.fn(),
            });

            await expect(object_server.delete_multiple_objects_unordered(mock_req))
                .rejects.toMatchObject({
                    rpc_code: 'UNAUTHORIZED',
                });

            expect(MDStore.instance().find_objects).not.toHaveBeenCalled();
            expect(MDStore.instance().remove_objects_and_unset_latest).not.toHaveBeenCalled();
        });

        test('deletes objects when none are Object Lock protected', async () => {
            const objects = [{ _id: 'obj1', key: 'a' }];
            const mock_req = {
                system: {
                    _id: 'system_id_123',
                    buckets_by_name: {
                        'test-bucket': {
                            _id: BUCKET_ID,
                            name: new SensitiveString('test-bucket'),
                        }
                    }
                },
                rpc_params: {
                    bucket: new SensitiveString('test-bucket'),
                    limit: 1000,
                },
            };

            jest.spyOn(MDStore, 'instance').mockReturnValue({
                has_any_locked_objects_in_bucket: jest.fn().mockResolvedValue(false),
                find_objects: jest.fn().mockResolvedValue(objects),
                remove_objects_and_unset_latest: jest.fn().mockResolvedValue(undefined),
                has_any_objects_for_bucket: jest.fn().mockResolvedValue(false),
            });

            const reply = await object_server.delete_multiple_objects_unordered(mock_req);
            expect(reply).toEqual({ is_empty: true });
            expect(MDStore.instance().remove_objects_and_unset_latest).toHaveBeenCalledWith(objects);
        });
    });

    describe('delete_bucket_and_objects', () => {

        test('marks deleting first, then rolls back when locked objects exist', async () => {
            const bucket = {
                _id: BUCKET_ID,
                name: new SensitiveString('test-bucket'),
            };
            const mock_req = {
                system: {
                    _id: 'system_id_123',
                    buckets_by_name: {
                        'test-bucket': bucket,
                    }
                },
                rpc_params: {
                    name: new SensitiveString('test-bucket'),
                },
                account: {
                    email: new SensitiveString('admin@noobaa.io'),
                },
            };

            jest.spyOn(MDStore, 'instance').mockReturnValue({
                has_any_locked_objects_in_bucket: jest.fn().mockResolvedValue(true),
            });
            const make_changes = jest.spyOn(system_store, 'make_changes').mockResolvedValue(undefined);

            await expect(bucket_server.delete_bucket_and_objects(mock_req))
                .rejects.toMatchObject({
                    rpc_code: 'UNAUTHORIZED',
                });

            // 1) fence writes (set deleting + rename), 2) rollback on lock
            expect(make_changes).toHaveBeenCalledTimes(2);
            expect(make_changes.mock.calls[0][0].update.buckets[0].$set.deleting).toBeInstanceOf(Date);
            expect(make_changes.mock.calls[0][0].update.buckets[0].$set.name)
                .toMatch(/^test-bucket-deleting-\d+$/);
            expect(make_changes.mock.calls[1][0].update.buckets[0]).toMatchObject({
                $set: { name: 'test-bucket' },
                $unset: { deleting: 1 },
            });
        });

        test('leaves bucket deleting when no locked objects exist', async () => {
            const bucket = {
                _id: BUCKET_ID,
                name: new SensitiveString('test-bucket'),
            };
            const mock_req = {
                system: {
                    _id: 'system_id_123',
                    buckets_by_name: {
                        'test-bucket': bucket,
                    }
                },
                rpc_params: {
                    name: new SensitiveString('test-bucket'),
                },
                account: {
                    email: new SensitiveString('admin@noobaa.io'),
                },
            };

            jest.spyOn(MDStore, 'instance').mockReturnValue({
                has_any_locked_objects_in_bucket: jest.fn().mockResolvedValue(false),
            });
            const make_changes = jest.spyOn(system_store, 'make_changes').mockResolvedValue(undefined);
            jest.spyOn(Dispatcher, 'instance').mockReturnValue({
                activity: jest.fn(),
            });

            await bucket_server.delete_bucket_and_objects(mock_req);

            expect(make_changes).toHaveBeenCalledTimes(1);
            expect(make_changes.mock.calls[0][0].update.buckets[0].$set.deleting).toBeInstanceOf(Date);
        });
    });
});
