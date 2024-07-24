/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const health = require('./health');
const config = require('../../config');
const http_utils = require('../util/http_utils');
const buffer_utils = require('../util/buffer_utils');
const { DIAGNOSE_ACTIONS } = require('./manage_nsfs_constants');
const ManageCLIError = require('./manage_nsfs_cli_errors').ManageCLIError;
const { throw_cli_error, write_stdout_response } = require('./manage_nsfs_cli_utils');
const ManageCLIResponse = require('../manage_nsfs/manage_nsfs_cli_responses').ManageCLIResponse;

/**
 * manage_diagnose_operations handles cli diagnose operations
 * @param {string} action 
 * @param {Object} user_input 
 * @param {Object} global_config 
 * @returns {Promise<Void>}
 */
async function manage_diagnose_operations(action, user_input, global_config) {
    switch (action) {
        case DIAGNOSE_ACTIONS.HEALTH:
            await health.get_health_status(user_input, global_config);
            break;
        case DIAGNOSE_ACTIONS.GATHER_LOGS:
            await gather_logs();
            break;
        case DIAGNOSE_ACTIONS.METRICS:
            await gather_metrics();
            break;
        default:
            throw_cli_error(ManageCLIError.InvalidAction);
    }
}

/**
 * gather_logs handles cli diagnose gather-logs operation
 * @returns {Promise<Void>}
 */
async function gather_logs() {
    throw_cli_error(ManageCLIError.NotImplemented);
}

/**
 * gather_metrics handles cli diagnose metrics operation
 * @returns {Promise<Void>}
 */
async function gather_metrics() {
    try {
        let metrics_output;
        const res = await http_utils.make_http_request({
            hostname: 'localhost',
            port: config.EP_METRICS_SERVER_PORT,
            path: '/metrics/nsfs_stats',
            method: 'GET'
        });
        if (res.statusCode === 200) {
            const buffer = await buffer_utils.read_stream_join(res);
            const body = buffer.toString('utf8');
            metrics_output = JSON.parse(body);
        }
        if (!metrics_output) throw new Error('recieved empty metrics response', { cause: res.statusCode });
        write_stdout_response(ManageCLIResponse.MetricsStatus, metrics_output);
    } catch (err) {
        dbg.warn('could not receive metrics response', err);
        throw_cli_error({ ...ManageCLIError.MetricsStatusFailed, cause: err?.errors?.[0] || err });
    }
}

exports.manage_diagnose_operations = manage_diagnose_operations;
