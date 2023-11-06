/* Copyright (C) 2016 NooBaa */
'use strict';

const prom_client = require('prom-client');
const config = require('../../../../config.js');

class BasePrometheusReport {
    constructor() {
        this._register = this.prom_client.register;
    }

    get prom_client() {
        return prom_client;
    }

    get register() {
        return this._register;
    }

    get metric_prefix() {
        return config.PROMETHEUS_PREFIX;
    }

    get enabled() {
        return config.PROMETHEUS_ENABLED;
    }

    get_prefixed_name(name) {
        return `${this.metric_prefix}${name}`;
    }

    export_metrics() {
        return this.register.metrics();
    }
}

exports.BasePrometheusReport = BasePrometheusReport;

