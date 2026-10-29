/* Copyright (C) 2026 NooBaa */
'use strict';

process.env.DISABLE_INIT_RANDOM_SEED = 'true';

jest.mock('../../../../config', () => ({
    BUCKET_LOG_TYPE: 'PERSISTENT',
}));

jest.mock('../../../util/notifications_util', () => ({
    compose_notification_req: jest.fn(),
    check_notif_relevant: jest.fn(() => false),
    check_free_space_if_needed: jest.fn(),
}));

jest.mock('../../../util/debug_module', () => () => ({
    log0: jest.fn(),
    log1: jest.fn(),
    log2: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

jest.mock('../../../util/http_utils', () => ({
    parse_client_ip: jest.fn(() => '203.0.113.1'),
}));

const {
    send_bucket_op_logs,
    get_bucket_log_record,
    is_bucket_logging_enabled,
} = require('../../../endpoint/s3/s3_bucket_logging');

function make_bucket_info() {
    return {
        bucket_owner: 'admin@test.io',
        bucket_info: {
            logging: {
                log_bucket: 'logs-bucket',
                log_prefix: 'logs/',
            },
        },
    };
}

function make_req(overrides = {}) {
    return {
        op_name: 'post_bucket_delete',
        method: 'POST',
        params: { bucket: 'source-bucket', key: 'placeholder-key' },
        originalUrl: '/source-bucket?delete',
        request_id: 'req-abc',
        log_ts: new Date('2026-10-28T09:00:00.000Z'),
        bucket_logger: { append: jest.fn().mockResolvedValue(undefined) },
        object_sdk: {
            read_bucket_sdk_config_info: jest.fn().mockResolvedValue(make_bucket_info()),
        },
        ...overrides,
    };
}

describe('s3_bucket_logging', () => {
    describe('is_bucket_logging_enabled', () => {
        it('returns true when logging is configured on the bucket', () => {
            expect(is_bucket_logging_enabled(make_bucket_info())).toBe(true);
        });

        it('returns false when logging is missing', () => {
            expect(is_bucket_logging_enabled({ bucket_info: {} })).toBe(false);
        });
    });

    describe('get_bucket_log_record', () => {
        it('uses req.params.key for object_key when present', () => {
            const req = {
                method: 'DELETE',
                params: { bucket: 'source-bucket', key: 'path/to/object.txt' },
                originalUrl: '/source-bucket?delete',
                request_id: 'req-1',
                log_ts: new Date('2026-10-28T09:00:00.000Z'),
            };
            const record = get_bucket_log_record('post_bucket_delete', make_bucket_info(), req, { statusCode: 204 });
            expect(record.object_key).toBe('path/to/object.txt');
            expect(record.op).toBe('DELETE');
            expect(record.http_status).toBe(204);
            expect(record.noobaa_bucket_logging).toBe(true);
        });
    });

    describe('send_bucket_op_logs DeleteObjects', () => {
        it('writes one persistent log line per successful DeleteResult entry', async () => {
            const req = make_req();
            const res = { statusCode: 200 };
            const reply = {
                DeleteResult: [
                    { Deleted: { Key: 'LICENSE' } },
                    { Error: { Key: 'missing.txt', Code: 'NoSuchKey' } },
                    { Deleted: { Key: 'tools.go' } },
                ],
            };

            await send_bucket_op_logs(req, res, reply);

            expect(req.object_sdk.read_bucket_sdk_config_info).toHaveBeenCalledWith('source-bucket');
            expect(req.bucket_logger.append).toHaveBeenCalledTimes(2);

            const logs = req.bucket_logger.append.mock.calls.map(call => JSON.parse(call[0]));
            expect(logs.map(l => l.object_key)).toEqual(['LICENSE', 'tools.go']);
            expect(logs.every(l => l.op === 'DELETE' && l.http_status === 204)).toBe(true);
            expect(logs.every(l => l.source_bucket === 'source-bucket')).toBe(true);

            expect(req.method).toBe('POST');
            expect(req.params.key).toBe('placeholder-key');
        });

        it('does not write bucket logs when logging is disabled', async () => {
            const req = make_req({
                object_sdk: {
                    read_bucket_sdk_config_info: jest.fn().mockResolvedValue({ bucket_info: {} }),
                },
            });
            const reply = { DeleteResult: [{ Deleted: { Key: 'a.txt' } }] };

            await send_bucket_op_logs(req, { statusCode: 200 }, reply);

            expect(req.bucket_logger.append).not.toHaveBeenCalled();
        });

        it('uses the single-request path for non DeleteObjects operations', async () => {
            const req = make_req({
                op_name: 'put_object',
                method: 'PUT',
                params: { bucket: 'source-bucket', key: 'obj.txt' },
            });
            const res = { statusCode: 200 };

            await send_bucket_op_logs(req, res, {});

            expect(req.bucket_logger.append).toHaveBeenCalledTimes(1);
            const log = JSON.parse(req.bucket_logger.append.mock.calls[0][0]);
            expect(log.op).toBe('PUT');
            expect(log.object_key).toBe('obj.txt');
            expect(log.http_status).toBe(200);
        });
    });
});
