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
        dbg.log0(`insert_replication`, item);
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
        dbg.log0(`update_replication`, item);
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

    async get_replication_by_id(replication_id) {
        dbg.log0('get_replication_by_id: ', replication_id);
        const repl = await this._replicationconfigs.findOne({ _id: db_client.instance().parse_object_id(replication_id), deleted: null });
        return repl && repl.rules;
    }

    async delete_replication_by_id(_id) {
        dbg.log0('delete_replication_by_id: ', _id);
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

    async update_replication_status_by_id(_id, rule_id, status) {
        dbg.log0('update_replication_status_by_id: ', _id, rule_id, status);
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

    async find_rules_updated_longest_time_ago() {
        dbg.log0('find_rules_updated_longest_time_ago: ');
        // TODO: postgres client does not support $project with $min op,
        // for doing an in db operation we will need to add support 
        // for aggregation framework in postgres client 
        const replications = await this._replicationconfigs.find({ deleted: null });
        dbg.log0('find_rules_updated_longest_time_ago: ', replications);

        const reduced_replications = _.map(replications, repl => ({
            replication_id: repl._id,
            rule: _.minBy(repl.rules, rule => (rule.rule_status && rule.rule_status.last_cycle_end) || 0) //least_recently_replicated_rule
        }));
        dbg.log0('find_rules_updated_longest_time_ago: ', reduced_replications);

        return reduced_replications;
    }
}

// EXPORTS
exports.ReplicationStore = ReplicationStore;
exports.instance = ReplicationStore.instance;
