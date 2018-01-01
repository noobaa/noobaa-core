/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const nodes_store = require('../node_services/nodes_store').NodesStore.instance();
const system_utils = require('../utils/system_utils');
const mongo_utils = require('../../util/mongo_utils');
const md_aggregator = require('./md_aggregator');

dbg.set_level(5);

/**************
 *
 * DB_CLEANER
 *
 * background worker that cleans documents that were deleted for a long time from the DB
 *
 * @this worker instance
 *
 *************************/
function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('DB_CLEANER: system_store did not finish initial load');
        return;
    }
    const system = system_store.data.systems[0];
    if (!system || system_utils.system_in_maintenance(system._id)) return;

    let last_date_to_remove = Date.now() - config.DB_CLEANER.BACK_TIME;

    if (this.last_check && Date.now() - this.last_check < config.DB_CLEANER.CYCLE) return P.resolve();
    const skip = new Error('skip');
    const LIMIT = 100;

    return P.resolve()
        .then(() => md_aggregator.find_minimal_range({
                target_now: Date.now(),
                system_store: system_store
            }) // checks what md_aggreagator should work on next
        )
        .then(range => {
            this.last_check = Date.now();
            if (range.from_time < last_date_to_remove) {
                dbg.log0('DB_CLEANER: waiting for md_aggreagator to advance to later than', new Date(last_date_to_remove));
                throw skip; // if md_aggreagator is still working on more than 3 month old objects - exit
            } else {
                dbg.log0('DB_CLEANER: checking the number of objects deleted before', new Date(last_date_to_remove));
                return MDStore.instance().find_deleted_objects(last_date_to_remove, LIMIT);
            }
        })
        .then(objects => {
            dbg.log2('DB_CLEANER: list objects:', objects);
            return objects &&
                P.map(objects, obj => db_delete_object_parts(obj), { concurrency: 10 })
                .then(() => MDStore.instance().db_delete_objects(objects));
        })
        .then(() => {
            dbg.log0('DB_CLEANER: checking the number of blocks deleted before', new Date(last_date_to_remove));
            return MDStore.instance().find_deleted_blocks(last_date_to_remove, LIMIT);
        })
        .then(blocks => {
            dbg.log2('DB_CLEANER: list blocks:', blocks);
            return blocks && MDStore.instance().db_delete_blocks(blocks);
        })
        .then(() => {
            dbg.log0('DB_CLEANER: checking the number of chunks deleted before', new Date(last_date_to_remove));
            return MDStore.instance().find_deleted_chunks(last_date_to_remove, LIMIT);
        }) // remove the objects
        .then(chunks => {
            dbg.log2('DB_CLEANER: list chunks:', chunks);
            const filtered_chunks = chunks.filter(chunk =>
                MDStore.instance().has_any_blocks_for_chunk(chunk) &&
                MDStore.instance().has_any_parts_for_chunk(chunk)
            );
            dbg.log2('DB_CLEANER: list chunks with no blocks and no parts to be removed from DB', filtered_chunks);
            return filtered_chunks && MDStore.instance().db_delete_chunks(filtered_chunks);
        })
        .then(() => {
            dbg.log0('DB_CLEANER: checking the number of nodes deleted before', new Date(last_date_to_remove));
            const query = {
                deleted: {
                    $lt: last_date_to_remove
                },
            };
            const options = {
                limit: LIMIT,
                fields: {
                    _id: 1,
                    deleted: 1
                }
            };
            return nodes_store.find_nodes(query, options)
                .then(objects => mongo_utils.uniq_ids(objects, '_id'));
        })
        .then(nodes => {
            dbg.log2('DB_CLEANER: list nodes:', nodes);
            const filtered_nodes = nodes.filter(node => true); // place holder - should verify the agents are really deleted
            dbg.log2('DB_CLEANER: list nodes with no agents to be removed from DB', filtered_nodes);
            return filtered_nodes && nodes_store.db_delete_nodes(filtered_nodes);
        })
        .then(() => {
            dbg.log0('DB_CLEANER: checking the number of system_store objects deleted before', new Date(last_date_to_remove));
            return P.join(
                system_store.find_deleted_docs('accounts', last_date_to_remove, LIMIT),
                system_store.find_deleted_docs('buckets', last_date_to_remove, LIMIT),
                system_store.find_deleted_docs('pools', last_date_to_remove, LIMIT)
            );
        })
        .spread((accounts, buckets, pools) => {
            dbg.log2('DB_CLEANER: list accounts:', accounts);
            dbg.log2('DB_CLEANER: list buckets:', buckets);
            dbg.log2('DB_CLEANER: list pools:', pools);
            const filtered_buckets = buckets.filter(bucket =>
                MDStore.instance().has_any_objects_for_bucket(bucket)
            );
            const filtered_pools = pools.filter(pool =>
                nodes_store.has_any_nodes_for_pool(pool)
            );
            return system_store.make_changes({
                db_delete: {
                    accounts: accounts,
                    buckets: filtered_buckets,
                    pools: filtered_pools
                }
            });
        })
        .catch(err => {
            if (err === skip) return;
            dbg.error('DB_CLEANER:', 'ERROR', err, err.stack);
            return config.DB_CLEANER.CYCLE;
        });
}

function db_delete_object_parts(obj) {
    if (!obj) return P.resolve();
    dbg.log0('DB_CLEANER: will remove all object mappings of this object:', obj);
    return P.join(
        MDStore.instance().db_delete_parts_of_object(obj),
        MDStore.instance().db_delete_multiparts_of_object(obj)
    );
}

// EXPORTS
exports.background_worker = background_worker;
