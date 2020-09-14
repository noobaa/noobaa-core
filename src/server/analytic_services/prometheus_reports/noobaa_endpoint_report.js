/* Copyright (C) 2016 NooBaa */
'use strict';

const { BasePrometheusReport } = require('./base_prometheus_report');

// -----------------------------------------
// A report for collecting endpoint metrics,
// this class is a shim that should who ever
// come next to add endpoint metrics reporting.
// -----------------------------------------
class NooBaaEndpointReport extends BasePrometheusReport {
    constructor() {
        super();

        if (this.enabled) {
            // Cache the client for ease of use.
            const client = this.prom_client;

            // Define storage for the metrics:
            this._metrics = {
                // This is a dummy metric that is used as an example, Gauge is use
                // here forbut it can be any of the metric types defined in the prom
                // client lib at https://github.com/siimon/prom-client with its
                // specific configuration.
                demo_metric: new client.Gauge({
                    name: this.get_prefixed_name('demo_metric'),
                    registers: [this.registry],
                    help: 'Description line for demo_metric',
                    // Other configurqation that should apply for this metric
                }),
            };
        }
    }

    get metric_prefix() {
        return `${super.metric_prefix}_Endpoint_`;
    }

    // Public interface to allow consuming code an interface for
    // setting/updating values for the various metrics, more complex
    // scenarios exists on the NooBaaCoreReport class
    set_metric1(data) {
        if (!this._metrics) return;

        this._metrics.metric_1.set(data);
    }
}

exports.NooBaaEndpointReport = NooBaaEndpointReport;
