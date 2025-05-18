/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');
const db_client = require('../../util/db_client');
const dbg = require('../../util/debug_module')(__filename);
const replication_schema = require('./schemas/replication_configuration_schema');

class ReplicationStore {

    constructor() {
        this._replicationconfigs = db_client.instance().define_collection({
            name: 'replicationconfigs',
            schema: replication_schema,
        });
    }

    static instance() {
        if (!ReplicationStore._instance) ReplicationStore._instance = new ReplicationStore();
        return ReplicationStore._instance;
    }

    async insert_replication(item) {
        item = _.omitBy(item, _.isNil);
        dbg.log1(`insert_replication`, item);
        const record = {
            _id: new mongodb.ObjectId(),
            ...item
        };
        this._replicationconfigs.validate(record);
        await this._replicationconfigs.insertOne(record);
        return record._id;
    }

    async update_replication(item, replication_id) {
        item = _.omitBy(item, _.isNil);
        dbg.log1(`update_replication`, item);
        const parsed_id = db_client.instance().parse_object_id(replication_id);
        const record = {
            _id: parsed_id,
            ...item
        };

        this._replicationconfigs.validate(record);
        await this._replicationconfigs.updateOne({
            _id: parsed_id,
            deleted: null
        }, {
            $set: {
                ...item
            },
        });
        return parsed_id;
    }

    async get_replication_rules() {
        const repl = await this._replicationconfigs.find({ deleted: null });
        return repl;
    }

    async find_deleted_rules(last_date_to_remove, limit) {
        const repl = this._replicationconfigs.find({
            deleted: {
                $lt: last_date_to_remove
            },
        }, { limit, projection: { _id: 1, deleted: 1 } });
        return repl;
    }

    async get_replication_by_id(replication_id) {
        dbg.log1('get_replication_by_id: ', replication_id);
        const repl = await this._replicationconfigs.findOne({ _id: db_client.instance().parse_object_id(replication_id), deleted: null });
        return repl && repl.rules;
    }

    async mark_deleted_replication_by_id(_id) {
        dbg.log0('mark_deleted_replication_by_id: ', _id);
        const ans = await this._replicationconfigs.updateOne({
            _id: db_client.instance().parse_object_id(_id),
            deleted: null
        }, {
            $set: {
                deleted: new Date(),
            },
        });
        return ans;
    }

    async actual_delete_replication_by_id(ids) {
        dbg.log0('actual_delete_replication_by_ids: ', ids);
        if (!ids || !ids.length) return;
        return this._replicationconfigs.deleteMany({
            _id: {
                $in: ids
            },
            deleted: { $exists: true }
        });
    }

    async update_replication_status_by_id(_id, rule_id, status) {
        dbg.log1('update_replication_status_by_id: ', _id, rule_id, status);
        const parsed_id = db_client.instance().parse_object_id(_id);
        const find = { _id: parsed_id, 'rules.rule_id': rule_id };
        const update = { $set: { 'rules.$.rule_status': status } };
        const options = { returnOriginal: false };
        dbg.log1('update_replication_status_by_id: ', find, update, options);
        const ans = await this._replicationconfigs.findOneAndUpdate(find, update, options);
        dbg.log1('update_replication_status_by_id: ans', ans);
        this._replicationconfigs.validate(ans.value, 'warn');
        return ans;
    }

    async update_log_replication_status_by_id(_id, last_cycle_end) {
        dbg.log1('update_log_replication_status_by_id: ', _id, last_cycle_end);
        const parsed_id = db_client.instance().parse_object_id(_id);
        const find = { _id: parsed_id };
        const update = { $set: { 'log_replication_info.status.last_cycle_end': last_cycle_end } };
        const options = { returnOriginal: false };
        dbg.log1('update_log_replication_status_by_id: ', find, update, options);
        const ans = await this._replicationconfigs.findOneAndUpdate(find, update, options);
        dbg.log1('update_log_replication_status_by_id: ans', ans);
        this._replicationconfigs.validate(ans.value, 'warn');
        return ans;
    }

    async update_log_replication_marker_by_id(_id, rule_id, log_marker) {
        dbg.log1('update_log_replication_marker_by_id: ', _id, rule_id, log_marker);
        const parsed_id = db_client.instance().parse_object_id(_id);
        const find = { _id: parsed_id, 'rules.rule_id': rule_id };

        const updates = {
            'rules.$.rule_log_status': {
                log_marker
            }
        };
        const update = { $set: updates };
        const options = { returnOriginal: false };
        dbg.log1('update_log_replication_marker_by_id: ', find, update, options);
        const ans = await this._replicationconfigs.findOneAndUpdate(find, update, options);
        dbg.log1('update_log_replication_marker_by_id: ans', ans);
        this._replicationconfigs.validate(ans.value, 'warn');
        return ans;
    }

    async find_rules_updated_longest_time_ago() {
        dbg.log1('find_rules_updated_longest_time_ago: ');
        // TODO: postgres client does not support $project with $min op,
        // for doing an in db operation we will need to add support 
        // for aggregation framework in postgres client 
        const replications = await this._replicationconfigs.find({ deleted: null });
        dbg.log1('find_rules_updated_longest_time_ago: ', replications);

        const reduced_replications = _.map(replications, repl => ({
            replication_id: repl._id,
            rule: _.minBy(repl.rules, rule => (rule.rule_status && rule.rule_status.last_cycle_end) || 0) //least_recently_replicated_rule
        }));
        dbg.log1('find_rules_updated_longest_time_ago: ', reduced_replications);

        return reduced_replications;
    }

    async find_log_based_replication_rules() {
        dbg.log1('find_log_based_replication_rules: ');
        const replications = await this._replicationconfigs.find({ deleted: null });
        const reduced_replications = _.filter(
            replications, repl => repl.log_replication_info?.endpoint_type ||
            repl.log_replication_info?.aws_log_replication_info
        );
        // TODO: Further transformation of the data can be done here - refer to find_rules_updated_longest_time_ago
        dbg.log1('find_log_based_replication_rules: ', reduced_replications);

        return reduced_replications;
    }

    async count_total_replication_rules() {
        return this._replicationconfigs.countDocuments({});
    }

}

// EXPORTS
exports.ReplicationStore = ReplicationStore;
exports.instance = ReplicationStore.instance;
