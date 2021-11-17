/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../util/promise');

const migrate_schema = {
    $id: 'migrate_schema',
    type: 'object',
    required: ['_id', 'collection_index'],
    properties: {
        _id: { objectid: true },
        collection_index: { type: 'number' },
        collection_name: { type: 'string' },
        last_move_size: { type: 'number' },
        total_move_size: { type: 'number' },
        marker: { objectid: true },
        last_update: { idate: true }
    }
};

/**
 *
 * Migrator
 *
 * taking two db's and move all the given collections between them
 *
 */
class Migrator {

    /**
     * @param {Object[]} collection_list
     * @param {nb.DBClient} from_client
     * @param {nb.DBClient} to_client
     * @param {number} [batch_size]
     */
    constructor(from_client, to_client, collection_list, batch_size) {
        this.collection_list = collection_list;
        this.from_client = from_client;
        this.to_client = to_client;
        this.batch_size = batch_size || 100;
    }

    async migrate_db() {
        this.to_client.define_collection({ name: 'migrate_status', schema: migrate_schema });
        for (const collection of this.collection_list) {
            await this.from_client.define_collection(_.omit(collection, 'db_indexes'));
            await this.to_client.define_collection(collection);
        }
        await this.from_client.connect(true);
        await this.to_client.connect();
        this.upgrade_table = this.to_client.collection('migrate_status');
        this.migrate_status = await this.upgrade_table.findOne({});
        if (!this.migrate_status) {
            this.migrate_status = {
                _id: this.to_client.new_object_id(),
                collection_index: 0,
                collection_name: this.collection_list[0].name,
                last_move_size: 0,
                total_move_size: 0,
                marker: undefined,
                last_update: Date.now(),
            };
            await this.upgrade_table.insertOne(this.migrate_status);
        }
        const start_index = this.migrate_status.collection_index;
        for (let i = start_index; i < this.collection_list.length; ++i) {
            const collection_name = this.collection_list[i].name;
            if (collection_name === 'system_history') {
                console.log(`skipping system_history collection migration due to possible heavy queries...`);
                continue;
            }
            this.migrate_status.collection_index = i;
            this.migrate_status.collection_name = collection_name;
            await P.retry({ attempts: 3, delay_ms: 10000, func: async () => this._migrate_collection(collection_name) });
            await this._verify_collection(collection_name);
            this.migrate_status.marker = undefined;
            await this.upgrade_table.updateOne({}, { $set: { collection_index: i + 1, last_update: Date.now() }, $unset: { marker: 1 } });
        }
        await this.from_client.disconnect();
        await this.to_client.disconnect();
    }

    async _migrate_collection(collection_name) {
        console.log(`migrating ${collection_name}`);
        const from_col = this.from_client.collection(collection_name);
        const to_col = this.to_client.collection(collection_name);
        let done = false;
        let marker = this.migrate_status.marker;
        let total = 0;
        while (!done) {
            console.log(`_migrate_collection: start searching docs in ${collection_name}`);
            const docs = await from_col.find({ _id: marker ? { $gt: marker } : undefined }, { limit: this.batch_size, sort: { _id: 1 } });
            console.log(`_migrate_collection: found ${docs.length} docs in ${collection_name}`);
            if (docs.length > 0) {
                try {
                    console.log(`_migrate_collection: insertMany started`);
                    await to_col.insertManyUnordered(docs);
                } catch (err) { // if duplicate key - continue
                    console.log('_migrate_collection: failed with error: ', err);
                    if (err.code !== '23505') throw err;
                }
                total += docs.length;
                console.log(`migrated ${total} documents to table ${collection_name}`);
                marker = docs[docs.length - 1]._id;
                await this.upgrade_table.updateOne({}, {
                    $set: {
                        marker,
                        last_move_size: docs.length,
                        total_move_size: total,
                        last_update: Date.now()
                    }
                });
            } else {
                done = true;
            }
        }
        console.log(`completed migration of ${total} documents to table ${collection_name}`);
    }

    async _verify_collection(collection_name) {
        console.log(`verifying ${collection_name}`);
        const from_col = this.from_client.collection(collection_name);
        const to_col = this.to_client.collection(collection_name);
        const from_documents_number = await from_col.countDocuments({});
        const to_documents_number = await to_col.countDocuments({});
        if (from_documents_number !== to_documents_number) {
            throw new Error(`Last migrate failed! collection ${collection_name} sizes don't match. 
                FROM: ${from_documents_number}, 
                TO: ${to_documents_number}`);
        }
    }
}

exports.Migrator = Migrator;
