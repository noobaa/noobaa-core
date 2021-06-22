/* Copyright (C) 2016 NooBaa */
'use strict';

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
        dbg.log0(`insert_replication`, item);
        const record = {
            _id: new mongodb.ObjectId(),
            rules: item,
        };
        this._replicationconfigs.validate(record);
        await this._replicationconfigs.insertOne(record);
        return record._id;
    }

    async update_replication(item, replication_id) {
        dbg.log0(`update_replication`, item);
        const parsed_id = db_client.instance().parse_object_id(replication_id);
        const record = {
            _id: parsed_id,
            rules: item,
        };

        this._replicationconfigs.validate(record);
        await this._replicationconfigs.updateOne({
            _id: parsed_id,
            deleted: null
        }, {
            $set: {
                rules: item,
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
}

// EXPORTS
exports.ReplicationStore = ReplicationStore;
exports.instance = ReplicationStore.instance;
