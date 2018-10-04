/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../util/promise');
const _ = require('lodash');
const dbg = require('../util/debug_module')(__filename);


// 30 seconds delay between reports
const SEND_STATS_DELAY = 30000;
const SEND_STATS_TIMEOUT = 20000;

class EndpointStatsCollector {

    constructor(rpc_client) {
        this.rpc_client = rpc_client;
        this.namespace_stats = {};
    }

    static instance(rpc_client) {
        if (!EndpointStatsCollector._instance) EndpointStatsCollector._instance = new EndpointStatsCollector(rpc_client);
        return EndpointStatsCollector._instance;
    }



    _new_namespace_stats() {
        return {
            read_count: 0,
            write_count: 0,
            read_bytes: 0,
            write_bytes: 0,
            error_write_bytes: 0,
            error_write_count: 0,
            error_read_bytes: 0,
            error_read_count: 0,
        };
    }

    update_namespace_read_stats({ namespace_resource_id, size = 0, count = 0, is_err }) {
        this.namespace_stats[namespace_resource_id] = this.namespace_stats[namespace_resource_id] || this._new_namespace_stats();
        const io_stats = this.namespace_stats[namespace_resource_id];
        if (is_err) {
            io_stats.error_read_count += count;
            io_stats.error_read_bytes += size;
        } else {
            io_stats.read_count += count;
            io_stats.read_bytes += size;
        }
        this._trigger_send_stats();
    }

    update_namespace_write_stats({ namespace_resource_id, size = 0, count = 0, is_err }) {
        this.namespace_stats[namespace_resource_id] = this.namespace_stats[namespace_resource_id] || this._new_namespace_stats();
        const io_stats = this.namespace_stats[namespace_resource_id];
        if (is_err) {
            io_stats.error_write_count += count;
            io_stats.error_write_bytes += size;
        } else {
            io_stats.write_count += count;
            io_stats.write_bytes += size;
        }
        this._trigger_send_stats();
    }

    async _send_stats() {
        await P.delay(SEND_STATS_DELAY);
        const namespace_stats = _.map(this.namespace_stats, (io_stats, namespace_resource_id) => ({
            io_stats,
            namespace_resource_id
        }));
        // clear this.send_stats to allow new updates to trigger another _send_stats
        this.send_stats = null;
        if (!namespace_stats.length) return;
        try {
            await this.rpc_client.object.update_endpoint_stats({
                namespace_stats
            }, {
                timeout: SEND_STATS_TIMEOUT
            });
            this.namespace_stats = {};
        } catch (err) {
            // if update failes trigger _send_stats again
            dbg.error('failed on update_endpoint_stats. trigger_send_stats again', err);
            this._trigger_send_stats();
        }
    }

    _trigger_send_stats() {
        if (!this.send_stats) {
            this.send_stats = this._send_stats();
        }
    }
}



// EXPORTS
exports.EndpointStatsCollector = EndpointStatsCollector;
exports.instance = EndpointStatsCollector.instance;
