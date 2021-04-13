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

// Currenty supported reprots
const reports = Object.seal({
    nodejs: new NodeJsReport(),
    core: null, // optional
    endpoint: null // optional
});

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
    retry_count = config.PROMETHEUS_SERVER_RETRY_COUNT,
    delay = config.PROMETHEUS_SERVER_RETRY_DELAY
) {
    if (!config.PROMETHEUS_ENABLED) {
        return;
    }

    const server = http.createServer(async (req, res) => {
        // Serve all metrics on the root path.
        if (req.url === '' || req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(await export_all_metrics());
            return;
        }

        // Serve report's metrics on the report name path
        const report_name = req.url.substr(1);
        const report = reports[report_name];
        if (report) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(await report.export_metrics(report_name));
            return;
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

// -----------------------------------------
// exports
// -----------------------------------------
exports.get_nodejs_report = get_nodejs_report;
exports.get_core_report = get_core_report;
exports.get_endpoint_report = get_endpoint_report;
exports.export_all_metrics = export_all_metrics;
exports.start_server = start_server;
