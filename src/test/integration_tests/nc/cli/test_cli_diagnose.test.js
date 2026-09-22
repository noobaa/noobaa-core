/* Copyright (C) 2016 NooBaa */
'use strict';

// disabling init_rand_seed as it takes longer than the actual test execution
process.env.DISABLE_INIT_RANDOM_SEED = "true";

const http = require('http');
const path = require('path');
const config = require('../../../../../config');
const { folder_delete } = require('../../../../util/fs_utils');
const { exec_manage_cli, TMP_PATH } = require('../../../system_tests/test_utils');
const { TYPES, DIAGNOSE_ACTIONS } = require('../../../../manage_nsfs/manage_nsfs_constants');
const ManageCLIError = require('../../../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;
const { ManageCLIResponse } = require('../../../../manage_nsfs/manage_nsfs_cli_responses');

const config_root = path.join(TMP_PATH, 'test_cli_diagnose');
const metrics_url = `http://127.0.0.1:${config.EP_METRICS_SERVER_PORT}/metrics/nsfs_stats`;
const metrics_obj_mock = {
    "nsfs_counters": {
        "noobaa_nsfs_io_read_count": 1,
        "noobaa_nsfs_io_write_count": 2,
        "noobaa_nsfs_io_read_bytes": 49,
        "noobaa_nsfs_io_write_bytes": 98
    },
    "op_stats_counters": {
        "noobaa_nsfs_op_create_bucket_min_time_milisec": 15,
        "noobaa_nsfs_op_create_bucket_max_time_milisec": 15,
        "noobaa_nsfs_op_create_bucket_avg_time_milisec": 15,
        "noobaa_nsfs_op_create_bucket_count": 1,
        "noobaa_nsfs_op_create_bucket_error_count": 0,
        "noobaa_nsfs_op_upload_object_min_time_milisec": 15,
        "noobaa_nsfs_op_upload_object_max_time_milisec": 20,
        "noobaa_nsfs_op_upload_object_avg_time_milisec": 17,
        "noobaa_nsfs_op_upload_object_count": 2,
        "noobaa_nsfs_op_upload_object_error_count": 0,
        "noobaa_nsfs_op_head_object_min_time_milisec": 2,
        "noobaa_nsfs_op_head_object_max_time_milisec": 3,
        "noobaa_nsfs_op_head_object_avg_time_milisec": 2,
        "noobaa_nsfs_op_head_object_count": 2,
        "noobaa_nsfs_op_head_object_error_count": 0,
        "noobaa_nsfs_op_read_object_min_time_milisec": 12,
        "noobaa_nsfs_op_read_object_max_time_milisec": 12,
        "noobaa_nsfs_op_read_object_avg_time_milisec": 12,
        "noobaa_nsfs_op_read_object_count": 1,
        "noobaa_nsfs_op_read_object_error_count": 0
    }
};

describe('noobaa cli - diagnose flow', () => {

    afterAll(async () => await folder_delete(config_root));

    describe('gather-logs flow', async => {
        it('gather-logs - should fail with not implemented', async () => {
            const res = await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.GATHER_LOGS, { config_root }, true);
            expect(JSON.parse(res.stdout).error.message).toBe(ManageCLIError.NotImplemented.message);
        });
    });

    describe('metrics flow', () => {

        it('diagnose metrics - should fail', async () => {
            let metrics_server;
            try {
                metrics_server = await start_metrics_mock_server();
                const res = await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.METRICS, { config_root }, true);
                const parsed_res = JSON.parse(res);
                expect(parsed_res.response.code).toBe(ManageCLIResponse.MetricsStatus.code);
                expect(parsed_res.response.reply).toMatchObject(metrics_obj_mock);
            } finally {
                stop_metrics_mock_server(metrics_server);
            }
        });

        it('diagnose metrics - should fail, metrics server is down', async () => {
            const res = await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.METRICS, { config_root }, true);
            const parsed_res = JSON.parse(res.stdout);
            expect(parsed_res.error.code).toBe(ManageCLIError.MetricsStatusFailed.code);
            expect(parsed_res.error.message).toBe(ManageCLIError.MetricsStatusFailed.message);
        });
    });
});


/**
 * Starts a metrics mock server that serves metrics_obj_mock on /metrics/nsfs_stats
 * @returns {Promise<import('http').Server>}
 */
function start_metrics_mock_server() {
    const server = http.createServer((req, res) => {
        if (req.url === '/metrics/nsfs_stats') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(metrics_obj_mock));
            return;
        }
        res.writeHead(404).end();
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.EP_METRICS_SERVER_PORT, () => {
            server.removeListener('error', reject);
            console.info(`HTTP server is listening on ${metrics_url}`);
            resolve(server);
        });
    });
}

/**
 * Stops a metrics mock server
 * @param {import('http').Server} [metrics_server]
 */
function stop_metrics_mock_server(metrics_server) {
    if (metrics_server) metrics_server.close();
}

