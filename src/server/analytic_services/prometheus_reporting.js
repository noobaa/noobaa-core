/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const http = require('http');
const config = require('../../../config');

// Import the reports.
const { NodeJsReport } = require('./prometheus_reports/nodejs_report');
const { NooBaaCoreReport } = require('./prometheus_reports/noobaa_core_report');
const { NooBaaEndpointReport } = require('./prometheus_reports/noobaa_endpoint_report');
const stats_aggregator = require('../system_services/stats_aggregator');
const AggregatorRegistry = require('prom-client').AggregatorRegistry;
const aggregatorRegistry = new AggregatorRegistry();

// Currenty supported reprots
const reports = Object.seal({
    nodejs: new NodeJsReport(),
    core: null, // optional
    endpoint: null // optional
});

let io_stats_complete = {};
let ops_stats_complete = {};

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

async function start_server(
    port,
    fork_enabled,
    retry_count = config.PROMETHEUS_SERVER_RETRY_COUNT,
    delay = config.PROMETHEUS_SERVER_RETRY_DELAY
) {
    if (!config.PROMETHEUS_ENABLED) {
        return;
    }

    const server = http.createServer(async (req, res) => {
        // Serve all metrics on the root path for system that do have one or more fork running.
        if (fork_enabled) {
            const metrics = await aggregatorRegistry.clusterMetrics();
            if (req.url === '' || req.url === '/') {
                res.writeHead(200, { 'Content-Type': aggregatorRegistry.contentType });
                res.end(metrics);
                return;
            }
            if (req.url === '/metrics/nsfs_stats') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                const nsfs_report = {
                    nsfs_counters: io_stats_complete,
                    op_stats_counters: ops_stats_complete,
                };
                res.end(JSON.stringify(nsfs_report));
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
    });

    // Try to open the port for listening, will retry then exist.
    dbg.log0('Starting prometheus metrics server on HTTP port', port);
    while (retry_count) {
        try {
            await new Promise((resolve, reject) => {
                server.listen(port, err => (err ? reject(err) : resolve()));
            });

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

    const nsfs_report = {
        nsfs_counters: nsfs_io_stats,
        op_stats_counters: op_stats_counters,
    };
    dbg.log1(`_create_nsfs_report: nsfs_report ${nsfs_report}`);
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
