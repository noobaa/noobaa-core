/* Copyright (C) 2016 NooBaa */
'use strict';

// Get metric from prometheus collector
function get_metric(stat_collector, name) {
    const metric_name = stat_collector.get_prefixed_name(name);
    return stat_collector.registry.getSingleMetric(metric_name);
}

// Reset all metrics in prometheus collector
function reset_metrics(stat_collector) {
    return stat_collector.registry.resetMetrics();
}

exports.get_metric = get_metric;
exports.reset_metrics = reset_metrics;
