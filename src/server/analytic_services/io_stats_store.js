/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const moment = require('moment');

const db_client = require('../../util/db_client');
const io_stats_schema = require('./io_stats_schema');
const io_stats_indexes = require('./io_stats_indexes');

class IoStatsStore {

    static instance(system) {
        IoStatsStore._instance = IoStatsStore._instance || new IoStatsStore();
        return IoStatsStore._instance;
    }

    constructor() {
        this._io_stats = db_client.instance().define_collection({
            name: 'iostats',
            schema: io_stats_schema,
            db_indexes: io_stats_indexes,
        });
    }

    ////////////////////
    // IO Stats funcs //
    ////////////////////

    async update_node_io_stats({ system, stats, node_id }) {
        await this._update_io_stats({
            system,
            resource_id: node_id,
            resource_type: 'NODE',
            stats
        });
    }

    async update_namespace_resource_io_stats({ system, stats, namespace_resource_id }) {
        await this._update_io_stats({
            system,
            resource_id: namespace_resource_id,
            resource_type: 'NAMESPACE_RESOURCE',
            stats
        });
    }

    async _update_io_stats({ system, resource_id, resource_type, stats }) {
        const start_time = moment(Date.now()).startOf('day').valueOf();
        const end_time = moment(Date.now()).endOf('day').valueOf();
        const selector = {
            system,
            resource_id,
            resource_type,
            start_time,
            end_time
        };
        const update = {
            $set: selector,
            $inc: _.pick(stats, 'read_count', 'write_count', 'read_bytes', 'write_bytes', 'error_read_count', 'error_write_count', 'error_read_bytes', 'error_write_bytes')
        };
        const res = await this._io_stats.findOneAndUpdate(selector, update, {
            upsert: true,
            returnOriginal: false
        });
        this._io_stats.validate(res.value, 'warn');
    }

    async get_all_nodes_stats({ system, start_date, end_date }) {
        return this._get_stats_for_resource_type({
            start_date,
            end_date,
            system,
            resource_type: 'NODE'
        });
    }

    async get_all_namespace_resources_stats({ system, start_date, end_date }) {
        return this._get_stats_for_resource_type({
            start_date,
            end_date,
            system,
            resource_type: 'NAMESPACE_RESOURCE'
        });
    }


    async _get_stats_for_resource_type({ start_date, end_date, system, resource_type }) {
        let start_time;
        if (start_date || end_date) start_time = _.omitBy({ $gte: start_date, $lte: end_date }, _.isUndefined);
        return this._io_stats.groupBy(
            _.omitBy({
                system,
                resource_type,
                start_time
            }, _.isUndefined), {
                _id: '$resource_id',
                read_count: { $sum: '$read_count' },
                write_count: { $sum: '$write_count' },
                read_bytes: { $sum: '$read_bytes' },
                write_bytes: { $sum: '$write_bytes' },
                error_read_count: { $sum: '$error_read_count' },
                error_write_count: { $sum: '$error_write_count' },
                error_read_bytes: { $sum: '$error_read_bytes' },
                error_write_bytes: { $sum: '$error_write_bytes' },
            }
        );
    }
}


// EXPORTS
exports.IoStatsStore = IoStatsStore;
