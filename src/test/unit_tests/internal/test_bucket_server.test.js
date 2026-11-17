/* Copyright (C) 2026 NooBaa */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const SensitiveString = require('../../../util/sensitive_string');

const mock_get_replication_by_id = jest.fn();
const mock_has_any_objects_for_bucket = jest.fn();

jest.mock('../../../server/system_services/replication_store', () => ({
    instance: jest.fn(() => ({
        get_replication_by_id: mock_get_replication_by_id,
    })),
}));

jest.mock('../../../server/notifications/dispatcher', () => ({
    instance: jest.fn(() => ({
        activity: jest.fn(),
        alert: jest.fn(),
    })),
}));

jest.mock('../../../server/object_services/md_store', () => ({
    MDStore: {
        instance: jest.fn(() => ({
            has_any_objects_for_bucket: mock_has_any_objects_for_bucket,
        })),
    },
}));

const bucket_server = require('../../../server/system_services/bucket_server');
const system_store = require('../../../server/system_services/system_store').get_instance();

describe('get_bucket_replication', () => {
    const src_bucket_name = 'src-bucket';
    const dst_bucket_name = 'dst-bucket';
    const dst_bucket_id = 'dst-bucket-id';
    const replication_policy_id = 'repl-policy-id';

    function make_req() {
        return {
            rpc_params: { name: new SensitiveString(src_bucket_name) },
            system: {
                buckets_by_name: {
                    [src_bucket_name]: {
                        _id: 'src-bucket-id',
                        name: new SensitiveString(src_bucket_name),
                        replication_policy_id,
                    },
                },
            },
        };
    }

    beforeEach(() => {
        mock_get_replication_by_id.mockReset();
        system_store.data = {
            get_by_id: jest.fn(id => {
                if (id === dst_bucket_id) {
                    return { name: new SensitiveString(dst_bucket_name) };
                }
                return undefined;
            }),
        };
    });

    it('maps replication.rules and resolves destination bucket names', async () => {
        mock_get_replication_by_id.mockResolvedValue({
            _id: replication_policy_id,
            rules: [
                {
                    rule_id: 'rule-1',
                    destination_bucket: dst_bucket_id,
                    sync_versions: false,
                    rule_status: { last_cycle_start: 1 },
                },
            ],
            log_replication_info: {
                aws_log_replication_info: {
                    logs_location: { logs_bucket: 'logs', prefix: 'p/' },
                },
            },
        });

        const res = await bucket_server.get_bucket_replication(make_req());

        expect(mock_get_replication_by_id).toHaveBeenCalledWith(replication_policy_id);
        expect(res.rules).toHaveLength(1);
        expect(res.rules[0].rule_id).toBe('rule-1');
        expect(res.rules[0].destination_bucket.unwrap()).toBe(dst_bucket_name);
        expect(res.rules[0].rule_status).toBeUndefined();
        expect(res.log_replication_info).toEqual({
            logs_location: { logs_bucket: 'logs', prefix: 'p/' },
        });
        expect(system_store.data.get_by_id).toHaveBeenCalledWith(dst_bucket_id);
    });

    it('returns multiple rules when the stored policy has several rules', async () => {
        const dst_bucket_id_2 = 'dst-bucket-id-2';
        system_store.data.get_by_id = jest.fn(id => {
            if (id === dst_bucket_id) return { name: new SensitiveString(dst_bucket_name) };
            if (id === dst_bucket_id_2) return { name: new SensitiveString('dst-2') };
            return undefined;
        });

        mock_get_replication_by_id.mockResolvedValue({
            rules: [
                { rule_id: 'rule-a', destination_bucket: dst_bucket_id },
                { rule_id: 'rule-b', destination_bucket: dst_bucket_id_2 },
            ],
        });

        const res = await bucket_server.get_bucket_replication(make_req());

        expect(res.rules).toHaveLength(2);
        expect(res.rules.map(r => r.rule_id)).toEqual(['rule-a', 'rule-b']);
    });

    it('throws NO_REPLICATION_ON_BUCKET when the bucket has no replication policy', async () => {
        const req = make_req();
        req.system.buckets_by_name[src_bucket_name].replication_policy_id = undefined;

        await expect(bucket_server.get_bucket_replication(req)).rejects.toMatchObject({
            rpc_code: 'NO_REPLICATION_ON_BUCKET',
        });
        expect(mock_get_replication_by_id).not.toHaveBeenCalled();
    });
});

describe('update_bucket quota mode', () => {
    const bucket_name = 'quota-bucket';
    const bucket_id = 'quota-bucket-id';

    function make_req(bucket_quota, update_quota, extra_bucket_props = {}) {
        return {
            rpc_params: {
                name: new SensitiveString(bucket_name),
                quota: update_quota,
            },
            system: {
                _id: 'sys-id',
                buckets_by_name: {
                    [bucket_name]: {
                        _id: bucket_id,
                        name: new SensitiveString(bucket_name),
                        quota: bucket_quota,
                        storage_stats: {
                            objects_size: 0,
                            objects_count: 0,
                        },
                        ...extra_bucket_props,
                    },
                },
            },
            account: {
                _id: 'acc-id',
                email: new SensitiveString('admin@noobaa.io'),
            },
        };
    }

    beforeEach(() => {
        mock_has_any_objects_for_bucket.mockReset();
        system_store.make_changes = jest.fn().mockResolvedValue({});
        system_store.data = {
            systems: [{ _id: 'sys-id' }],
        };
    });

    it('preserves strict mode when mode is not specified on quota update', async () => {
        const existing_quota = {
            size: { value: 10, unit: 'G' },
            mode: 'strict',
        };
        const update_quota = {
            size: { value: 20, unit: 'G' },
        };
        const req = make_req(existing_quota, update_quota);

        await bucket_server.update_bucket(req);

        expect(system_store.make_changes).toHaveBeenCalledTimes(1);
        const changes = system_store.make_changes.mock.calls[0][0];
        expect(changes.update.buckets[0].quota).toEqual({
            size: { value: 20, unit: 'G' },
            mode: 'strict',
        });
    });

    it('changes mode to async when mode is explicitly set to async on strict quota bucket', async () => {
        const existing_quota = {
            size: { value: 10, unit: 'G' },
            mode: 'strict',
        };
        const update_quota = {
            size: { value: 20, unit: 'G' },
            mode: 'async',
        };
        const req = make_req(existing_quota, update_quota);

        await bucket_server.update_bucket(req);

        expect(system_store.make_changes).toHaveBeenCalledTimes(1);
        const changes = system_store.make_changes.mock.calls[0][0];
        expect(changes.update.buckets[0].quota).toEqual({
            size: { value: 20, unit: 'G' },
        });
    });

    it('preserves async mode when mode is not specified on async quota bucket', async () => {
        const existing_quota = {
            size: { value: 10, unit: 'G' },
        };
        const update_quota = {
            size: { value: 20, unit: 'G' },
        };
        const req = make_req(existing_quota, update_quota);

        await bucket_server.update_bucket(req);

        expect(system_store.make_changes).toHaveBeenCalledTimes(1);
        const changes = system_store.make_changes.mock.calls[0][0];
        expect(changes.update.buckets[0].quota).toEqual({
            size: { value: 20, unit: 'G' },
        });
    });

    it('defaults to async mode when setting quota for the first time without mode', async () => {
        const update_quota = {
            size: { value: 20, unit: 'G' },
        };
        const req = make_req(undefined, update_quota);

        await bucket_server.update_bucket(req);

        expect(system_store.make_changes).toHaveBeenCalledTimes(1);
        const changes = system_store.make_changes.mock.calls[0][0];
        expect(changes.update.buckets[0].quota).toEqual({
            size: { value: 20, unit: 'G' },
        });
    });

    it('enables strict quota on an empty bucket when mode is explicitly strict', async () => {
        mock_has_any_objects_for_bucket.mockResolvedValue(false);
        const update_quota = {
            size: { value: 15, unit: 'G' },
            mode: 'strict',
        };
        const req = make_req(undefined, update_quota);

        await bucket_server.update_bucket(req);

        expect(mock_has_any_objects_for_bucket).toHaveBeenCalledWith(bucket_id);
        expect(system_store.make_changes).toHaveBeenCalledTimes(1);
        const changes = system_store.make_changes.mock.calls[0][0];
        expect(changes.update.buckets[0].quota).toEqual({
            size: { value: 15, unit: 'G' },
            mode: 'strict',
        });
    });

    it('throws INVALID_BUCKET_STATE when enabling strict quota on a non-empty bucket', async () => {
        mock_has_any_objects_for_bucket.mockResolvedValue(true);
        const update_quota = {
            size: { value: 15, unit: 'G' },
            mode: 'strict',
        };
        const req = make_req(undefined, update_quota);

        await expect(bucket_server.update_bucket(req)).rejects.toMatchObject({
            rpc_code: 'INVALID_BUCKET_STATE',
            message: 'Strict quota can only be set on an empty bucket',
        });
        expect(system_store.make_changes).not.toHaveBeenCalled();
    });

    it('throws BAD_REQUEST when setting strict quota on a namespace bucket', async () => {
        const update_quota = {
            size: { value: 15, unit: 'G' },
            mode: 'strict',
        };
        const req = make_req(undefined, update_quota, {
            namespace: {
                read_resources: [],
                write_resource: {},
            },
        });

        await expect(bucket_server.update_bucket(req)).rejects.toMatchObject({
            rpc_code: 'BAD_REQUEST',
            message: 'Strict quota is not supported on namespace buckets',
        });
        expect(mock_has_any_objects_for_bucket).not.toHaveBeenCalled();
        expect(system_store.make_changes).not.toHaveBeenCalled();
    });

    it('does not check for empty bucket when updating limits on an already strict quota bucket', async () => {
        const existing_quota = {
            size: { value: 10, unit: 'G' },
            mode: 'strict',
        };
        const update_quota = {
            size: { value: 30, unit: 'G' },
            mode: 'strict',
        };
        const req = make_req(existing_quota, update_quota);

        await bucket_server.update_bucket(req);

        expect(mock_has_any_objects_for_bucket).not.toHaveBeenCalled();
        expect(system_store.make_changes).toHaveBeenCalledTimes(1);
        const changes = system_store.make_changes.mock.calls[0][0];
        expect(changes.update.buckets[0].quota).toEqual({
            size: { value: 30, unit: 'G' },
            mode: 'strict',
        });
    });

    it('sets strict quota with quantity limit', async () => {
        mock_has_any_objects_for_bucket.mockResolvedValue(false);
        const update_quota = {
            quantity: { value: 500 },
            mode: 'strict',
        };
        const req = make_req(undefined, update_quota);

        await bucket_server.update_bucket(req);

        expect(system_store.make_changes).toHaveBeenCalledTimes(1);
        const changes = system_store.make_changes.mock.calls[0][0];
        expect(changes.update.buckets[0].quota).toEqual({
            quantity: { value: 500 },
            mode: 'strict',
        });
    });

    it('unsets quota to null when quota is set on a strict quota', async () => {
        const existing_quota = {
            size: { value: 10, unit: 'G' },
            mode: 'strict',
        };
        const update_quota = null;
        const req = make_req(existing_quota, update_quota);

        await bucket_server.update_bucket(req);

        expect(system_store.make_changes).toHaveBeenCalledTimes(1);
        const changes = system_store.make_changes.mock.calls[0][0];
        expect(changes.update.buckets[0].$unset).toEqual({ quota: 1 });
    });

    it('throws BAD_REQUEST when setting negative quota values on strict quota', async () => {
        const update_quota = {
            size: { value: -5, unit: 'G' },
            mode: 'strict',
        };
        const req = make_req(undefined, update_quota);

        await expect(bucket_server.update_bucket(req)).rejects.toMatchObject({
            rpc_code: 'BAD_REQUEST',
            message: 'quota config values must be positive',
        });
        expect(system_store.make_changes).not.toHaveBeenCalled();
    });
});
