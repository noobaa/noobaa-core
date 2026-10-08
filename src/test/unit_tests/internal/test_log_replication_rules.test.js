/* Copyright (C) 2026 NooBaa */
'use strict';

const { ReplicationStore } = require('../../../server/system_services/replication_store');

const replication_store = new ReplicationStore();

describe('find_log_based_replication_rules', () => {
    const original_find = replication_store._replicationconfigs.find;

    afterEach(() => {
        replication_store._replicationconfigs.find = original_find;
    });

    it('an Azure policy with a prefix is log based', async () => {
        const repl = { log_replication_info: { azure_log_replication_info: { prefix: 'logs/' } } };
        await expect_selected([repl], [repl]);
    });

    it('an Azure policy without a prefix is log based', async () => {
        const repl = { log_replication_info: { azure_log_replication_info: {} } };
        await expect_selected([repl], [repl]);
    });

    it('an AWS policy with a logs bucket is log based', async () => {
        const repl = {
            log_replication_info: {
                aws_log_replication_info: { logs_location: { logs_bucket: 'logs' } },
            },
        };
        await expect_selected([repl], [repl]);
    });

    it('an AWS policy with a logs prefix is log based', async () => {
        const repl = {
            log_replication_info: {
                aws_log_replication_info: { logs_location: { logs_bucket: 'logs', prefix: 'access/' } },
            },
        };
        await expect_selected([repl], [repl]);
    });

    it('an AWS policy with endpoint type inside the logs location is log based', async () => {
        // The request may put endpoint_type inside logs_location. The stored object keeps that under aws_log_replication_info.
        const repl = {
            log_replication_info: {
                aws_log_replication_info: {
                    logs_location: { logs_bucket: 'logs', endpoint_type: 'AWS' },
                },
            },
        };
        await expect_selected([repl], [repl]);
    });

    it('a policy with only an endpoint type is not log based', async () => {
        const azure = { log_replication_info: { endpoint_type: 'AZURE' } };
        const aws = { log_replication_info: { endpoint_type: 'AWS' } };
        await expect_selected([azure, aws], []);
    });

    it('a mix of log policies and scan policies returns only the log policies', async () => {
        const aws = {
            log_replication_info: {
                aws_log_replication_info: { logs_location: { logs_bucket: 'logs' } },
            },
        };
        const azure = { log_replication_info: { azure_log_replication_info: { prefix: 'logs/' } } };
        const endpoint_only = { log_replication_info: { endpoint_type: 'AZURE' } };
        const scan = { rules: [] };
        const status_only = { log_replication_info: { status: { last_cycle_end: Date.now() } } };

        await expect_selected([scan, aws, endpoint_only, azure, status_only], [aws, azure]);
    });

    it('a scan policy is not log based', async () => {
        const policies = [
            { rules: [] },
            { log_replication_info: {} },
            { log_replication_info: { status: { last_cycle_end: Date.now() } } },
        ];
        await expect_selected(policies, []);
    });
});

/**
 * @param {object[]} stored_policies
 * @param {object[]} expected
 */
async function expect_selected(stored_policies, expected) {
    const find = jest.fn().mockResolvedValue(stored_policies);
    replication_store._replicationconfigs.find = find;

    const found = await replication_store.find_log_based_replication_rules();

    expect(find).toHaveBeenCalledWith({ deleted: null });
    expect(found).toEqual(expected);
}
