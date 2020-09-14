/* Copyright (C) 2016 NooBaa */
'use strict';

const prom_client = require('prom-client');
const config = require('../../../../config.js');

class BasePrometheusReport {
    constructor() {
        this._registry = new this.prom_client.Registry();
    }

    get prom_client() {
        return prom_client;
    }

    get registry() {
        return this._registry;
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
        return this.registry.metrics();
    }
}

exports.BasePrometheusReport = BasePrometheusReport;

