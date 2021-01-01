/* Copyright (C) 2016 NooBaa */
'use strict';

const { BasePrometheusReport } = require('./base_prometheus_report');
const dbg = require('../../../util/debug_module')(__filename);

// -----------------------------------------
// Report containing node.js metrics
// collected and provided by the prom client
// -----------------------------------------
class NodeJsReport extends BasePrometheusReport {
    constructor() {
        super();

        if (this.enabled) {
            this.prom_client.collectDefaultMetrics({
                register: this.registry,
                prefix: this.metric_prefix
            });
        }
    }

    get metric_prefix() {
        // replacing dashes to underscores because dash is illegal as metric name
        // but is common as a process name
        const process_name = dbg.get_process_name().replace(/-/g, '_');
        return `${super.metric_prefix}${process_name}_`;
    }
}

exports.NodeJsReport = NodeJsReport;
