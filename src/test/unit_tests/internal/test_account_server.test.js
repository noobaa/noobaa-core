/* Copyright (C) 2026 NooBaa */
/* eslint max-lines-per-function: ['error', 1200] */

'use strict';

const SensitiveString = require('../../../util/sensitive_string');

const MOCK_ACCOUNT_ID = 'account_id_123';
const MOCK_POOL_ID = 'pool_id_456';
const MOCK_NS_RESOURCE_ID = 'ns_resource_id_789';
const MOCK_AUTH_TOKEN = 'mock_auth_token';
const MOCK_MASTER_KEY_ID = 'master_key_id_abc';

function make_sensitive(str) {
    return new SensitiveString(str);
}

const mock_connection = {
    name: 'my-connection',
    endpoint: 'http://endpoint-a.example.com',
    endpoint_type: 'S3_COMPATIBLE',
    access_key: make_sensitive('old_access_key'),
    secret_key: make_sensitive('old_secret_key'),
    region: 'us-east-1',
};

function make_mock_pool(overrides = {}) {
    return {
        _id: MOCK_POOL_ID,
        cloud_pool_info: {
            endpoint_type: mock_connection.endpoint_type,
            endpoint: mock_connection.endpoint,
            access_keys: {
                account_id: { _id: MOCK_ACCOUNT_ID },
                access_key: mock_connection.access_key,
                secret_key: mock_connection.secret_key,
            },
        },
        ...overrides,
    };
}

function make_mock_ns_resource(overrides = {}) {
    return {
        _id: MOCK_NS_RESOURCE_ID,
        account: { _id: MOCK_ACCOUNT_ID },
        connection: {
            endpoint_type: mock_connection.endpoint_type,
            endpoint: mock_connection.endpoint,
            access_key: mock_connection.access_key,
            secret_key: mock_connection.secret_key,
        },
        ...overrides,
    };
}

// --- Mocks ---

const mock_system_store = {
    master_key_manager: {
        encrypt_sensitive_string_with_master_key_id: jest.fn(secret => make_sensitive('encrypted_' + secret)),
    },
    data: {
        pools: [],
        namespace_resources: [],
    },
    make_changes: jest.fn().mockResolvedValue(undefined),
};

const mock_server_rpc = {
    client: {
        hosted_agents: {
            update_hosted_agents: jest.fn().mockResolvedValue(undefined),
        },
    },
};

const mock_cloud_utils = {
    find_cloud_connection: jest.fn().mockReturnValue(mock_connection),
    get_s3_endpoint_signature_ver: jest.fn().mockReturnValue('v4'),
};

const mock_noobaa_s3_client = {
    get_s3_client_v3_params: jest.fn(),
    get_requestHandler_with_suitable_agent: jest.fn().mockReturnValue({}),
};

jest.mock('../../../../config', () => {
    const { EventEmitter } = require('events');
    return {
        DEFAULT_REGION: 'us-east-1',
        event_emitter: new EventEmitter(),
        LOG_TO_STDERR_ENABLED: false,
        LOG_TO_SYSLOG_ENABLED: false,
        DEBUG_FACILITY: 'LOG_LOCAL0',
    };
});
jest.mock('../../../util/debug_module', () => {
    const mock_dbg = {
        log0: jest.fn(),
        log1: jest.fn(),
        log2: jest.fn(),
        log3: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        set_module_level: jest.fn(),
    };
    return () => mock_dbg;
});
jest.mock('../../../util/cloud_utils', () => mock_cloud_utils);
jest.mock('../../../server/system_services/system_store', () => ({
    get_instance: () => mock_system_store,
}));
jest.mock('../../../server/server_rpc', () => mock_server_rpc);
jest.mock('../../../sdk/noobaa_s3_client/noobaa_s3_client', () => mock_noobaa_s3_client);
jest.mock('../../../util/promise', () => ({
    timeout: jest.fn((timeout, promise) => promise),
}));
jest.mock('../../../rpc', () => ({
    RpcError: class RpcError extends Error {
        constructor(rpc_code, message) {
            super(message || rpc_code);
            this.rpc_code = rpc_code;
        }
    },
}));
jest.mock('../../../server/notifications/dispatcher', () => ({ instance: () => ({}) }));
jest.mock('../../../server/bg_services/usage_aggregator', () => ({}));
jest.mock('../../../endpoint/sts/sts_rest', () => ({ OP_NAME_TO_ACTION: {} }));
jest.mock('@azure/monitor-query-logs', () => ({ Durations: {}, LogsQueryClient: jest.fn() }));
jest.mock('@azure/identity', () => ({ ClientSecretCredential: jest.fn() }));
jest.mock('../../../util/NetStorageKit-Node-master/lib/netstorage', () => jest.fn());
jest.mock('../../../util/account_util', () => ({}));
jest.mock('../../../endpoint/iam/iam_utils', () => ({}));
jest.mock('../../../endpoint/iam/iam_constants', () => ({
    IAM_ACTIONS: {},
    IAM_DEFAULT_PATH: '/',
    ACCESS_KEY_STATUS_ENUM: {},
    MAX_TAGS: 50,
    MAX_NUMBER_OF_IAM_ROLES: 100,
    DEFAULT_MAX_SESSION_DURATION_SECS: 3600,
}));

const account_server = require('../../../server/system_services/account_server');

describe('account_server - update_external_connection', () => {

    let mock_req;

    beforeEach(() => {
        jest.clearAllMocks();
        mock_cloud_utils.find_cloud_connection.mockReturnValue({ ...mock_connection });
        mock_cloud_utils.get_s3_endpoint_signature_ver.mockReturnValue('v4');
        mock_noobaa_s3_client.get_requestHandler_with_suitable_agent.mockReturnValue({});
        mock_system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id
            .mockImplementation(secret => make_sensitive('encrypted_' + secret));
        mock_system_store.make_changes.mockResolvedValue(undefined);
        mock_server_rpc.client.hosted_agents.update_hosted_agents.mockResolvedValue(undefined);
        mock_system_store.data.pools = [];
        mock_system_store.data.namespace_resources = [];

        mock_req = {
            account: {
                _id: MOCK_ACCOUNT_ID,
                master_key_id: { _id: MOCK_MASTER_KEY_ID },
                sync_credentials_cache: [mock_connection],
            },
            rpc_params: {
                name: 'my-connection',
                identity: make_sensitive('new_access_key'),
                secret: make_sensitive('new_secret_key'),
            },
            auth_token: MOCK_AUTH_TOKEN,
        };
    });

    describe('endpoint update validation', () => {

        test('should throw FORBIDDEN when endpoint_type is not S3_COMPATIBLE or IBM_COS', async () => {
            mock_cloud_utils.find_cloud_connection.mockReturnValue({
                ...mock_connection,
                endpoint_type: 'AWS',
            });
            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'AWS',
                bucket: 'my-bucket',
            };

            await expect(account_server.update_external_connection(mock_req))
                .rejects.toMatchObject({ rpc_code: 'FORBIDDEN' });
        });

        test('should allow endpoint update for S3_COMPATIBLE connections', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 1 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'S3_COMPATIBLE',
                bucket: 'my-bucket',
            };

            await account_server.update_external_connection(mock_req);
            expect(mock_system_store.make_changes).toHaveBeenCalled();
        });

        test('should allow endpoint update for IBM_COS connections', async () => {
            mock_cloud_utils.find_cloud_connection.mockReturnValue({
                ...mock_connection,
                endpoint_type: 'IBM_COS',
            });
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 1 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'IBM_COS',
                bucket: 'my-bucket',
            };

            await account_server.update_external_connection(mock_req);
            expect(mock_system_store.make_changes).toHaveBeenCalled();
        });

        test('should not set endpoint_update when endpoint has not changed', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_req.rpc_params.endpoint_info = {
                endpoint: mock_connection.endpoint,
            };

            await account_server.update_external_connection(mock_req);

            const make_changes_arg = mock_system_store.make_changes.mock.calls[0][0];
            const acc_set = make_changes_arg.update.accounts[0].$set;
            expect(acc_set).not.toHaveProperty('sync_credentials_cache.$.endpoint');
        });
    });

    describe('noobaa_blocks prefix check during endpoint update', () => {

        test('should fail with INVALID_ENDPOINT when new endpoint bucket has no noobaa_blocks prefix', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 0 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'S3_COMPATIBLE',
                bucket: 'my-bucket',
            };

            await expect(account_server.update_external_connection(mock_req))
                .rejects.toMatchObject({ rpc_code: 'INVALID_ENDPOINT' });
        });

        test('should succeed when new endpoint bucket has noobaa_blocks prefix', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 1 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'S3_COMPATIBLE',
                bucket: 'my-bucket',
            };

            await account_server.update_external_connection(mock_req);
            expect(mock_system_store.make_changes).toHaveBeenCalled();
        });

        test('should call listObjectsV2 with correct bucket and prefix', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 1 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'S3_COMPATIBLE',
                bucket: 'target-bucket',
            };

            await account_server.update_external_connection(mock_req);
            expect(mock_s3.listObjectsV2).toHaveBeenCalledWith({
                Bucket: 'target-bucket',
                Prefix: 'noobaa_blocks/',
                MaxKeys: 1,
            });
        });

        test('should not call listObjectsV2 when endpoint is not being updated', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn(),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            await account_server.update_external_connection(mock_req);
            expect(mock_s3.listObjectsV2).not.toHaveBeenCalled();
        });
    });

    describe('credential updates', () => {

        test('should update account credentials when identity and secret are provided', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            await account_server.update_external_connection(mock_req);

            const make_changes_arg = mock_system_store.make_changes.mock.calls[0][0];
            const acc_set = make_changes_arg.update.accounts[0].$set;
            expect(acc_set['sync_credentials_cache.$.access_key']).toEqual(make_sensitive('new_access_key'));
            expect(acc_set['sync_credentials_cache.$.secret_key']).toBeDefined();
        });

        test('should use connection access_key as identity when rpc_params.identity is not provided', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            delete mock_req.rpc_params.identity;

            await account_server.update_external_connection(mock_req);

            const make_changes_arg = mock_system_store.make_changes.mock.calls[0][0];
            const acc_set = make_changes_arg.update.accounts[0].$set;
            expect(acc_set['sync_credentials_cache.$.access_key'].unwrap()).toBe('old_access_key');
        });
    });

    describe('pool and namespace resource updates with endpoint change', () => {

        test('should include endpoint in pool updates when endpoint is changed', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 1 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_system_store.data.pools = [make_mock_pool()];
            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'S3_COMPATIBLE',
                bucket: 'my-bucket',
            };

            await account_server.update_external_connection(mock_req);

            const make_changes_arg = mock_system_store.make_changes.mock.calls[0][0];
            const pool_update = make_changes_arg.update.pools[0];
            expect(pool_update['cloud_pool_info.endpoint']).toBe('http://new-endpoint.example.com');
            expect(pool_update['cloud_pool_info.endpoint_type']).toBe('S3_COMPATIBLE');
        });

        test('should include endpoint in namespace resource updates when endpoint is changed', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 1 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_system_store.data.namespace_resources = [make_mock_ns_resource()];
            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'S3_COMPATIBLE',
                bucket: 'my-bucket',
            };

            await account_server.update_external_connection(mock_req);

            const make_changes_arg = mock_system_store.make_changes.mock.calls[0][0];
            const ns_update = make_changes_arg.update.namespace_resources[0];
            expect(ns_update['connection.endpoint']).toBe('http://new-endpoint.example.com');
            expect(ns_update['connection.endpoint_type']).toBe('S3_COMPATIBLE');
        });

        test('should not include endpoint fields in pool update when endpoint unchanged', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_system_store.data.pools = [make_mock_pool()];

            await account_server.update_external_connection(mock_req);

            const make_changes_arg = mock_system_store.make_changes.mock.calls[0][0];
            const pool_update = make_changes_arg.update.pools[0];
            expect(pool_update).not.toHaveProperty('cloud_pool_info.endpoint');
            expect(pool_update).not.toHaveProperty('cloud_pool_info.endpoint_type');
        });
    });

    describe('hosted agents update', () => {

        test('should call update_hosted_agents with endpoint when pools are updated and endpoint changed', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 1 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_system_store.data.pools = [make_mock_pool()];
            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'S3_COMPATIBLE',
                bucket: 'my-bucket',
            };

            await account_server.update_external_connection(mock_req);

            expect(mock_server_rpc.client.hosted_agents.update_hosted_agents).toHaveBeenCalledWith(
                expect.objectContaining({
                    pool_ids: [String(MOCK_POOL_ID)],
                    endpoint: 'http://new-endpoint.example.com',
                    endpoint_type: 'S3_COMPATIBLE',
                }),
                { auth_token: MOCK_AUTH_TOKEN }
            );
        });

        test('should call update_hosted_agents with credentials when pools are updated', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_system_store.data.pools = [make_mock_pool()];

            await account_server.update_external_connection(mock_req);

            expect(mock_server_rpc.client.hosted_agents.update_hosted_agents).toHaveBeenCalledWith(
                expect.objectContaining({
                    pool_ids: [String(MOCK_POOL_ID)],
                    credentials: {
                        access_key: 'new_access_key',
                        secret_key: 'new_secret_key',
                    },
                }),
                { auth_token: MOCK_AUTH_TOKEN }
            );
        });

        test('should not call update_hosted_agents when no pools match', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_system_store.data.pools = [];

            await account_server.update_external_connection(mock_req);

            expect(mock_server_rpc.client.hosted_agents.update_hosted_agents).not.toHaveBeenCalled();
        });
    });

    describe('connection check failure propagation', () => {

        test('should throw INVALID_CREDENTIALS when check_aws_connection returns that status', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockRejectedValue(
                    Object.assign(new Error('invalid creds'), { code: 'InvalidAccessKeyId' })
                ),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            await expect(account_server.update_external_connection(mock_req))
                .rejects.toMatchObject({ rpc_code: 'INVALID_CREDENTIALS' });
        });

        test('should throw INVALID_ENDPOINT when noobaa_blocks check fails during endpoint update', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockResolvedValue({}),
                listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 0 }),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            mock_req.rpc_params.endpoint_info = {
                endpoint: 'http://new-endpoint.example.com',
                endpoint_type: 'S3_COMPATIBLE',
                bucket: 'my-bucket',
            };

            await expect(account_server.update_external_connection(mock_req))
                .rejects.toMatchObject({ rpc_code: 'INVALID_ENDPOINT' });
        });

        test('should throw TIMEOUT when connection times out', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockRejectedValue(
                    Object.assign(new Error('Operation timeout'), { code: 'OperationTimeout' })
                ),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            await expect(account_server.update_external_connection(mock_req))
                .rejects.toMatchObject({ rpc_code: 'TIMEOUT' });
        });

        test('should propagate error.code when _check_external_connection_internal throws unexpectedly', async () => {
            mock_cloud_utils.get_s3_endpoint_signature_ver.mockImplementation(() => {
                throw Object.assign(new Error('something broke'), { code: 'UNEXPECTED_FAILURE' });
            });

            await expect(account_server.update_external_connection(mock_req))
                .rejects.toMatchObject({ rpc_code: 'UNEXPECTED_FAILURE' });
        });

        test('should fall back to INTERNAL_ERROR when thrown error has no code', async () => {
            mock_cloud_utils.get_s3_endpoint_signature_ver.mockImplementation(() => {
                throw new Error('unknown error');
            });

            await expect(account_server.update_external_connection(mock_req))
                .rejects.toMatchObject({ rpc_code: 'INTERNAL_ERROR' });
        });

        test('should not call make_changes when connection check fails', async () => {
            const mock_s3 = {
                listBuckets: jest.fn().mockRejectedValue(
                    Object.assign(new Error('invalid creds'), { code: 'InvalidAccessKeyId' })
                ),
            };
            mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

            await expect(account_server.update_external_connection(mock_req))
                .rejects.toThrow();
            expect(mock_system_store.make_changes).not.toHaveBeenCalled();
        });
    });
});

describe('account_server - check_aws_connection (endpoint update)', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        mock_cloud_utils.find_cloud_connection.mockReturnValue({ ...mock_connection });
        mock_cloud_utils.get_s3_endpoint_signature_ver.mockReturnValue('v4');
        mock_noobaa_s3_client.get_requestHandler_with_suitable_agent.mockReturnValue({});
        mock_system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id
            .mockImplementation(secret => make_sensitive('encrypted_' + secret));
        mock_system_store.make_changes.mockResolvedValue(undefined);
        mock_server_rpc.client.hosted_agents.update_hosted_agents.mockResolvedValue(undefined);
        mock_system_store.data.pools = [];
        mock_system_store.data.namespace_resources = [];
    });

    test('should return SUCCESS when listBuckets succeeds and no endpoint update', async () => {
        const mock_s3 = {
            listBuckets: jest.fn().mockResolvedValue({}),
        };
        mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

        const mock_req = {
            account: {
                _id: MOCK_ACCOUNT_ID,
                master_key_id: { _id: MOCK_MASTER_KEY_ID },
                sync_credentials_cache: [mock_connection],
            },
            rpc_params: {
                name: 'my-connection',
                identity: make_sensitive('access_key'),
                secret: make_sensitive('secret_key'),
            },
            auth_token: MOCK_AUTH_TOKEN,
        };

        await account_server.update_external_connection(mock_req);
        expect(mock_s3.listBuckets).toHaveBeenCalled();
        expect(mock_system_store.make_changes).toHaveBeenCalled();
    });

    test('should check noobaa_blocks when endpoint_update is true', async () => {
        const mock_s3 = {
            listBuckets: jest.fn().mockResolvedValue({}),
            listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 2 }),
        };
        mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

        const mock_req = {
            account: {
                _id: MOCK_ACCOUNT_ID,
                master_key_id: { _id: MOCK_MASTER_KEY_ID },
                sync_credentials_cache: [mock_connection],
            },
            rpc_params: {
                name: 'my-connection',
                identity: make_sensitive('access_key'),
                secret: make_sensitive('secret_key'),
                endpoint_info: {
                    endpoint: 'http://different-endpoint.example.com',
                    endpoint_type: 'S3_COMPATIBLE',
                    bucket: 'target-bucket',
                },
            },
            auth_token: MOCK_AUTH_TOKEN,
        };

        await account_server.update_external_connection(mock_req);
        expect(mock_s3.listObjectsV2).toHaveBeenCalledWith({
            Bucket: 'target-bucket',
            Prefix: 'noobaa_blocks/',
            MaxKeys: 1,
        });
    });

    test('should throw INVALID_ENDPOINT when noobaa_blocks not found on new endpoint', async () => {
        const mock_s3 = {
            listBuckets: jest.fn().mockResolvedValue({}),
            listObjectsV2: jest.fn().mockResolvedValue({ KeyCount: 0 }),
        };
        mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

        const mock_req = {
            account: {
                _id: MOCK_ACCOUNT_ID,
                master_key_id: { _id: MOCK_MASTER_KEY_ID },
                sync_credentials_cache: [mock_connection],
            },
            rpc_params: {
                name: 'my-connection',
                identity: make_sensitive('access_key'),
                secret: make_sensitive('secret_key'),
                endpoint_info: {
                    endpoint: 'http://different-endpoint.example.com',
                    endpoint_type: 'S3_COMPATIBLE',
                    bucket: 'target-bucket',
                },
            },
            auth_token: MOCK_AUTH_TOKEN,
        };

        await expect(account_server.update_external_connection(mock_req))
            .rejects.toMatchObject({ rpc_code: 'INVALID_ENDPOINT' });
    });

    test('should prepend http:// to endpoint if no protocol specified', async () => {
        mock_cloud_utils.find_cloud_connection.mockReturnValue({
            ...mock_connection,
            endpoint: 'bare-endpoint.example.com',
        });
        const mock_s3 = {
            listBuckets: jest.fn().mockResolvedValue({}),
        };
        mock_noobaa_s3_client.get_s3_client_v3_params.mockReturnValue(mock_s3);

        const mock_req = {
            account: {
                _id: MOCK_ACCOUNT_ID,
                master_key_id: { _id: MOCK_MASTER_KEY_ID },
                sync_credentials_cache: [{ ...mock_connection, endpoint: 'bare-endpoint.example.com' }],
            },
            rpc_params: {
                name: 'my-connection',
                identity: make_sensitive('access_key'),
                secret: make_sensitive('secret_key'),
            },
            auth_token: MOCK_AUTH_TOKEN,
        };

        await account_server.update_external_connection(mock_req);
        const s3_params = mock_noobaa_s3_client.get_s3_client_v3_params.mock.calls[0][0];
        expect(s3_params.endpoint).toBe('http://bare-endpoint.example.com');
    });
});
