/* Copyright (C) 2026 NooBaa */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

jest.mock('../../../server/system_services/replication_store', () => {
    const store = {
        get_replication_by_id: jest.fn(),
    };
    return {
        instance: jest.fn(() => store),
    };
});

const RpcError = require('../../../rpc/rpc_error');
const SensitiveString = require('../../../util/sensitive_string');
const replication_store = require('../../../server/system_services/replication_store');
const bucket_server = require('../../../server/system_services/bucket_server');
const system_store = require('../../../server/system_services/system_store').get_instance();
const { validate_log_replication_logs_bucket } = bucket_server;

const mock_get_replication_by_id = replication_store.instance().get_replication_by_id;

const OWNER_A = { _id: { toString: () => 'owner-a' } };
const OWNER_B = { _id: { toString: () => 'owner-b' } };

function make_req({ src_name = 'src-bucket', log_replication_info, buckets_by_name }) {
    return {
        rpc_params: {
            name: new SensitiveString(src_name),
            replication_policy: {
                rules: [],
                log_replication_info,
            },
        },
        system: {
            buckets_by_name: buckets_by_name || {},
        },
    };
}

function bucket_entry(name, owner) {
    return {
        name: new SensitiveString(name),
        owner_account: owner,
    };
}

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

describe('validate_log_replication_logs_bucket', () => {

    it('does nothing when log_replication_info is absent', () => {
        const req = make_req({ log_replication_info: undefined });
        expect(() => validate_log_replication_logs_bucket(req)).not.toThrow();
    });

    it('skips validation for AWS endpoint_type', () => {
        const req = make_req({
            log_replication_info: {
                endpoint_type: 'AWS',
                logs_location: { logs_bucket: 'missing-remote-logs' },
            },
        });
        expect(() => validate_log_replication_logs_bucket(req)).not.toThrow();
    });

    it('skips validation for AZURE endpoint_type', () => {
        const req = make_req({
            log_replication_info: {
                endpoint_type: 'AZURE',
            },
        });
        expect(() => validate_log_replication_logs_bucket(req)).not.toThrow();
    });

    it('skips validation when endpoint_type is omitted (legacy AWS path)', () => {
        const req = make_req({
            log_replication_info: {
                logs_location: { logs_bucket: 'not-a-local-bucket' },
            },
        });
        expect(() => validate_log_replication_logs_bucket(req)).not.toThrow();
    });

    it('requires logs_location.logs_bucket for NOOBAA', () => {
        const req = make_req({
            log_replication_info: {
                endpoint_type: 'NOOBAA',
                logs_location: {},
            },
            buckets_by_name: {
                'src-bucket': bucket_entry('src-bucket', OWNER_A),
            },
        });
        try {
            validate_log_replication_logs_bucket(req);
            throw new Error('expected RpcError');
        } catch (err) {
            expect(err).toBeInstanceOf(RpcError);
            expect(err.rpc_code).toBe('INVALID_TARGET_BUCKET');
            expect(err.message).toMatch(/logs_location\.logs_bucket is required/);
        }
    });

    it('rejects when the log bucket does not exist locally', () => {
        const req = make_req({
            log_replication_info: {
                endpoint_type: 'NOOBAA',
                logs_location: { logs_bucket: 'log-bucket', prefix: 'p/' },
            },
            buckets_by_name: {
                'src-bucket': bucket_entry('src-bucket', OWNER_A),
            },
        });
        try {
            validate_log_replication_logs_bucket(req);
            throw new Error('expected RpcError');
        } catch (err) {
            expect(err).toBeInstanceOf(RpcError);
            expect(err.rpc_code).toBe('INVALID_TARGET_BUCKET');
            expect(err.message).toMatch(/does not exist/);
        }
    });

    it('rejects when the log bucket is owned by a different account than the source bucket', () => {
        const req = make_req({
            log_replication_info: {
                endpoint_type: 'NOOBAA',
                logs_location: { logs_bucket: 'log-bucket' },
            },
            buckets_by_name: {
                'src-bucket': bucket_entry('src-bucket', OWNER_A),
                'log-bucket': bucket_entry('log-bucket', OWNER_B),
            },
        });
        try {
            validate_log_replication_logs_bucket(req);
            throw new Error('expected RpcError');
        } catch (err) {
            expect(err).toBeInstanceOf(RpcError);
            expect(err.rpc_code).toBe('INVALID_TARGET_BUCKET');
            expect(err.message).toMatch(/not owned by you/);
        }
    });

    it('accepts when the log bucket exists and is owned by the same account as the source bucket', () => {
        const req = make_req({
            log_replication_info: {
                endpoint_type: 'NOOBAA',
                logs_location: { logs_bucket: 'log-bucket', prefix: 'logs/' },
            },
            buckets_by_name: {
                'src-bucket': bucket_entry('src-bucket', OWNER_A),
                'log-bucket': bucket_entry('log-bucket', OWNER_A),
            },
        });
        expect(() => validate_log_replication_logs_bucket(req)).not.toThrow();
    });

    it('validates logs bucket during pre-creation when the source bucket is absent', () => {
        const req = make_req({
            src_name: 'src-not-created-yet',
            log_replication_info: {
                endpoint_type: 'NOOBAA',
                logs_location: { logs_bucket: 'log-bucket' },
            },
            buckets_by_name: {
                'log-bucket': bucket_entry('log-bucket', OWNER_A),
            },
        });
        expect(() => validate_log_replication_logs_bucket(req)).not.toThrow();
    });

    it('rejects missing logs bucket during pre-creation when the source bucket is absent', () => {
        const req = make_req({
            src_name: 'src-not-created-yet',
            log_replication_info: {
                endpoint_type: 'NOOBAA',
                logs_location: { logs_bucket: 'log-bucket' },
            },
            buckets_by_name: {},
        });
        try {
            validate_log_replication_logs_bucket(req);
            throw new Error('expected RpcError');
        } catch (err) {
            expect(err).toBeInstanceOf(RpcError);
            expect(err.rpc_code).toBe('INVALID_TARGET_BUCKET');
            expect(err.message).toMatch(/does not exist/);
        }
    });
});
