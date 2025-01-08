/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');

// Import the reports.
const { NodeJsReport } = require('./prometheus_reports/nodejs_report');
const { NooBaaCoreReport } = require('./prometheus_reports/noobaa_core_report');
const { NooBaaEndpointReport } = require('./prometheus_reports/noobaa_endpoint_report');
const stats_aggregator = require('../system_services/stats_aggregator');
const AggregatorRegistry = require('prom-client').AggregatorRegistry;
const aggregatorRegistry = new AggregatorRegistry();
const http_utils = require('../../util/http_utils');

// Currenty supported reprots
const reports = Object.seal({
    nodejs: new NodeJsReport(),
    core: null, // optional
    endpoint: null // optional
});

let io_stats_complete = {};
let ops_stats_complete = {};
let fs_worker_stats_complete = {};

function get_nodejs_report() {
    return reports.nodejs;
}

function get_core_report(peek = false) {
    if (!reports.core && !peek) reports.core = new NooBaaCoreReport();
    return reports.core;
}

function get_endpoint_report(peek = false) {
    if (!reports.endpoint && !peek) reports.endpoint = new NooBaaEndpointReport();
    return reports.endpoint;
}

async function export_all_metrics() {
    const all_metrics = await Promise.all(
        Object.values(reports)
            .filter(Boolean)
            .map(report => report.export_metrics())
    );
    return all_metrics.join('\n\n');
}

/**
 * Start Noobaa metrics server for http and https server
 * 
 * @param {number?} port prometheus metris port.
 * @param {number?} ssl_port prometheus metris https port.
 * @param {boolean?} fork_enabled request from frok or not.
 * @param {string?} nsfs_config_root nsfs configuration path
 */
async function start_server(
    port,
    ssl_port = 0,
    fork_enabled = false,
    nsfs_config_root = '',
    retry_count = config.PROMETHEUS_SERVER_RETRY_COUNT,
    retry_https_count = config.PROMETHEUS_SERVER_RETRY_COUNT,
    delay = config.PROMETHEUS_SERVER_RETRY_DELAY
) {
    if (!config.PROMETHEUS_ENABLED) {
        return;
    }
    const metrics_request_handler = async (req, res) => {
        // Serve all metrics on the root path for system that do have one or more fork running.
        if (fork_enabled) {
            // we would like this part to be first as clusterMetrics might fail.
            if (req.url === '/metrics/nsfs_stats') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                const nsfs_report = {
                    nsfs_counters: io_stats_complete,
                    op_stats_counters: ops_stats_complete,
                    fs_worker_stats_counters: fs_worker_stats_complete
                };
                res.end(JSON.stringify(nsfs_report));
                return;
            }
            let metrics;
            try {
                metrics = await aggregatorRegistry.clusterMetrics();
            } catch (err) {
                dbg.error('start_server: Could not get the metrics, got an error', err);
                res.writeHead(504, { 'Content-Type': 'application/json' });
                const reply = JSON.stringify({
                    error: 'Internal server error - timeout',
                    message: 'Looks like the server is taking a long time to respond (Could not get the metrics)',
                });
                res.end(reply);
                return;
            }
            if (req.url === '' || req.url === '/') {
                res.writeHead(200, { 'Content-Type': aggregatorRegistry.contentType });
                res.end(metrics);
                return;
            }
            // Serve report's metrics on the report name path
            const report_name = req.url.substr(1);
            const single_metrics = export_single_metrics(metrics, report_name);
            if (single_metrics !== "") {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(single_metrics);
                return;
            }
        } else {
            // Serve all metrics on the root path for system that do not have any fork running.
            if (req.url === '' || req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(await export_all_metrics());
                return;
            }
            if (req.url === '/metrics/nsfs_stats') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(await metrics_nsfs_stats_handler());
                return;
            }
            const report_name = req.url.substr(1);
            const report = reports[report_name];
            if (report) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(await report.export_metrics(report_name));
                return;
            }
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end();
    };

    // Try to open the port for listening, will retry then exist.
    while (retry_count) {
        try {
            if (nsfs_config_root && !config.ALLOW_HTTP_METRICS) {
                dbg.warn('HTTP is not allowed for NC NSFS metrics server.');
            } else if (port > 0) {
                await http_utils.start_http_server(port, 'METRICS', metrics_request_handler);
            } else {
                dbg.warn('Port is not configured for metrics server');
            }
            // Set retry_count to 0 to exit the loop
            retry_count = 0;

        } catch (err) {
            if (retry_count) {
                dbg.error(`Metrics server failed to listen on ${port} (retries left: ${retry_count}), got`, err);
                await P.delay_unblocking(delay);
            } else {
                dbg.error(`Metrics server failed to listen on ${port} too many times, existing the process`);
                process.exit();
            }
        }
    }

    while (retry_https_count) {
        try {
            if (ssl_port > 0 && config.ALLOW_HTTPS_METRICS) {
                await http_utils.start_https_server(ssl_port, 'METRICS', metrics_request_handler, nsfs_config_root);
            } else {
                dbg.warn('HTTPS is not allowed or ssl port missing for Noobaa metrics server. ssl_port: ', ssl_port);
            }
            // Set retry_https_count to 0 to exit the loop
            retry_https_count = 0;

        } catch (err) {
            if (retry_https_count) {
                dbg.error(`Metrics server failed to listen on ${ssl_port} (retries left: ${retry_https_count}), got`, err);
                await P.delay_unblocking(delay);
            } else {
                dbg.error(`Metrics server failed to listen on ${ssl_port} too many times, existing the process`);
                process.exit();
            }
        }
    }
}

async function metrics_nsfs_stats_handler() {
    const nsfs_io_stats = {};
    const nsfs_counters = stats_aggregator.get_nsfs_io_stats(false);
    // Building the report per io and value
    for (const [key, value] of Object.entries(nsfs_counters)) {
        nsfs_io_stats[`noobaa_nsfs_io_${key}`.toLowerCase()] = value;
    }

    const op_stats_counters = {};
    const op_stats = stats_aggregator.get_op_stats(false);
    // Building the report per op name key and value
    for (const [op_name, obj] of Object.entries(op_stats)) {
        for (const [key, value] of Object.entries(obj)) {
            op_stats_counters[`noobaa_nsfs_op_${op_name}_${key}`.toLowerCase()] = value;
        }
    }

    const fs_worker_stats_counters = {};
    const fs_worker_stats = stats_aggregator.get_fs_workers_stats(false);
    // Building the report per fs worker name key and value
    for (const [fs_op_name, obj] of Object.entries(fs_worker_stats)) {
        for (const [key, value] of Object.entries(obj)) {
            fs_worker_stats_counters[`noobaa_nsfs_fs_worker_${fs_op_name}_${key}`.toLowerCase()] = value;
        }
    }


    const nsfs_report = {
        nsfs_counters: nsfs_io_stats,
        op_stats_counters: op_stats_counters,
        fs_worker_stats_counters: fs_worker_stats_counters
    };
    dbg.log1('_create_nsfs_report: nsfs_report', nsfs_report);
    return JSON.stringify(nsfs_report);
}

function export_single_metrics(all_metrics, report_name) {
    let single_metrics = "";
    const metrics_arr = all_metrics.split('\n');
    for (const metrics_line of metrics_arr) {
        if (metrics_line.includes(report_name)) {
            single_metrics = single_metrics + metrics_line + "\n";
        }
    }
    return single_metrics;

}

function set_io_stats(io_stats) {
    const nsfs_io_stats = {};
    for (const [key, value] of Object.entries(io_stats)) {
        nsfs_io_stats[`noobaa_nsfs_io_${key}`.toLowerCase()] = value;
    }
    io_stats_complete = nsfs_io_stats;
}

function set_ops_stats(ops_stats) {
    const op_stats_counters = {};
    // Building the report per op name key and value
    for (const [op_name, obj] of Object.entries(ops_stats)) {
        for (const [key, value] of Object.entries(obj)) {
            op_stats_counters[`noobaa_nsfs_op_${op_name}_${key}`.toLowerCase()] = value;
        }
    }
    ops_stats_complete = op_stats_counters;
}

function set_fs_worker_stats(fs_worker_stats) {
    const op_stats_counters = {};
    // Building the report per op name key and value
    for (const [op_name, obj] of Object.entries(fs_worker_stats)) {
        for (const [key, value] of Object.entries(obj)) {
            op_stats_counters[`noobaa_nsfs_op_${op_name}_${key}`.toLowerCase()] = value;
        }
    }
    fs_worker_stats_complete = op_stats_counters;
}

// -----------------------------------------
// exports
// -----------------------------------------
exports.get_nodejs_report = get_nodejs_report;
exports.get_core_report = get_core_report;
exports.get_endpoint_report = get_endpoint_report;
exports.export_all_metrics = export_all_metrics;
exports.start_server = start_server;
exports.set_io_stats = set_io_stats;
exports.set_ops_stats = set_ops_stats;
exports.set_fs_worker_stats = set_fs_worker_stats;
