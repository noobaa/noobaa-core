/* Copyright (C) 2026 NooBaa */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const SensitiveString = require('../../../util/sensitive_string');

const mock_get_replication_by_id = jest.fn();

jest.mock('../../../server/system_services/replication_store', () => ({
    instance: jest.fn(() => ({
        get_replication_by_id: mock_get_replication_by_id,
    })),
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
