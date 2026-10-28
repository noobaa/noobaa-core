/* Copyright (C) 2026 NooBaa */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

const SensitiveString = require('../../../util/sensitive_string');
const RpcError = require('../../../rpc/rpc_error');
const { validate_log_replication_logs_bucket } = require('../../../server/system_services/bucket_server');

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

    it('accepts when the source bucket is not in buckets_by_name yet (ownership check skipped)', () => {
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
});
