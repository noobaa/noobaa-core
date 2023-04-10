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
const db_client = require('../../util/db_client');
const md_aggregator = require('./md_aggregator');

/**************
 *
 * DB_CLEANER
 *
 * background worker that cleans documents that were deleted for a long time from the DB
 *
 * @this worker instance
 *
 *************************/
async function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('DB_CLEANER: system_store did not finish initial load');
        return;
    }
    const system = system_store.data.systems[0];
    if (!system || system_utils.system_in_maintenance(system._id)) return;
    const now = Date.now();

    let last_date_to_remove = now - config.DB_CLEANER.BACK_TIME;
    if (this.last_check && now - this.last_check < config.DB_CLEANER.CYCLE) return config.DB_CLEANER.CYCLE;
    this.last_check = now;
    const { from_time } = md_aggregator.find_minimal_range({
        target_now: now,
        system_store: system_store
    });
    dbg.log2('DB_CLEANER: md_aggregator at', new Date(from_time));
    if (from_time < last_date_to_remove) {
        dbg.log0('DB_CLEANER: waiting for md_aggregator to advance to later than', new Date(last_date_to_remove));
        return config.DB_CLEANER.CYCLE; // if md_aggregator is still working on more than 3 month old objects - exit
    }
    dbg.log0('DB_CLEANER:', 'START');
    await clean_md_store(last_date_to_remove);
    await clean_nodes_store(last_date_to_remove);
    await clean_system_store(last_date_to_remove);
    dbg.log0('DB_CLEANER:', 'END');
    return config.DB_CLEANER.CYCLE;
}

async function clean_md_store(last_date_to_remove) {
    const total_objects_count = await MDStore.instance().estimated_total_objects();
    if (total_objects_count < config.DB_CLEANER.MAX_TOTAL_DOCS) {
        dbg.log0(`DB_CLEANER: found less than ${config.DB_CLEANER.MAX_TOTAL_DOCS} objects in MD-STORE 
        ${total_objects_count} objects - Skipping...`);
        return;
    }
    dbg.log0('DB_CLEANER: checking md-store for documents deleted before', new Date(last_date_to_remove));
    const objects_to_remove = await MDStore.instance().find_deleted_objects(last_date_to_remove, config.DB_CLEANER.DOCS_LIMIT);
    dbg.log2('DB_CLEANER: list objects:', objects_to_remove);
    if (objects_to_remove.length) {
        await P.map_with_concurrency(10, objects_to_remove, obj => db_delete_object_parts(obj));
        await MDStore.instance().db_delete_objects(objects_to_remove);
    }
    const blocks_to_remove = await MDStore.instance().find_deleted_blocks(last_date_to_remove, config.DB_CLEANER.DOCS_LIMIT);
    dbg.log2('DB_CLEANER: list blocks:', blocks_to_remove);
    if (blocks_to_remove.length) await MDStore.instance().db_delete_blocks(blocks_to_remove);
    const chunks_to_remove = await MDStore.instance().find_deleted_chunks(last_date_to_remove, config.DB_CLEANER.DOCS_LIMIT);
    const filtered_chunks = chunks_to_remove.filter(async chunk =>
        !(await MDStore.instance().has_any_blocks_for_chunk(chunk)) &&
        !(await MDStore.instance().has_any_parts_for_chunk(chunk)));
    dbg.log2('DB_CLEANER: list chunks with no blocks and no parts to be removed from DB', filtered_chunks);
    if (filtered_chunks.length) await MDStore.instance().db_delete_chunks(filtered_chunks);
    dbg.log0(`DB_CLEANER: removed ${objects_to_remove.length + blocks_to_remove.length + filtered_chunks.length} documents from md-store`);
}

async function db_delete_object_parts(id) {
    if (!id) return;
    return P.all([
        MDStore.instance().db_delete_parts_of_object(id),
        MDStore.instance().db_delete_multiparts_of_object(id)
    ]);
}

async function clean_nodes_store(last_date_to_remove) {
    const total_nodes_count = await nodes_store.count_total_nodes();
    if (total_nodes_count < config.DB_CLEANER.MAX_TOTAL_DOCS) {
        dbg.log0(`DB_CLEANER: found less than ${config.DB_CLEANER.MAX_TOTAL_DOCS} nodes in nodes-store 
        ${total_nodes_count} nodes - Skipping...`);
        return;
    }
    dbg.log0('DB_CLEANER: checking nodes-store for nodes deleted before', new Date(last_date_to_remove));
    const query = {
        deleted: {
            $lt: last_date_to_remove
        },
    };
    const nodes = await nodes_store.find_nodes(query, config.DB_CLEANER.DOCS_LIMIT, { _id: 1, deleted: 1 });
    const node_ids = db_client.instance().uniq_ids(nodes, '_id');
    dbg.log2('DB_CLEANER: list nodes:', node_ids);
    const filtered_nodes = node_ids.filter(node => true); // place holder - should verify the agents are really deleted
    dbg.log2('DB_CLEANER: list nodes with no agents to be removed from DB', filtered_nodes);
    if (filtered_nodes.length) await nodes_store.db_delete_nodes(filtered_nodes);
    dbg.log0(`DB_CLEANER: removed ${filtered_nodes.length} documents from nodes-store`);
}

async function clean_system_store(last_date_to_remove) {
    const total_accounts_count = await system_store.count_total_docs('accounts');
    const total_buckets_count = await system_store.count_total_docs('buckets');
    const total_pools_count = await system_store.count_total_docs('pools');
    if ((total_accounts_count < config.DB_CLEANER.MAX_TOTAL_DOCS) &&
        (total_buckets_count < config.DB_CLEANER.MAX_TOTAL_DOCS) &&
        (total_pools_count < config.DB_CLEANER.MAX_TOTAL_DOCS)) {
        dbg.log0(`DB_CLEANER: found less than ${config.DB_CLEANER.MAX_TOTAL_DOCS} docs in system-store 
        ${total_accounts_count} accounts, ${total_buckets_count} buckets, ${total_pools_count} pools - Skipping...`);
        return;
    }
    dbg.log0('DB_CLEANER: checking system_store for documents deleted before', new Date(last_date_to_remove));
    const [accounts, buckets, pools] = await P.all([
        system_store.find_deleted_docs('accounts', last_date_to_remove, config.DB_CLEANER.DOCS_LIMIT),
        system_store.find_deleted_docs('buckets', last_date_to_remove, config.DB_CLEANER.DOCS_LIMIT),
        system_store.find_deleted_docs('pools', last_date_to_remove, config.DB_CLEANER.DOCS_LIMIT)
    ]);
    dbg.log2('DB_CLEANER: list accounts:', accounts);
    dbg.log2('DB_CLEANER: list buckets:', buckets);
    dbg.log2('DB_CLEANER: list pools:', pools);
    const filtered_buckets = buckets.filter(async bucket =>
        !(await MDStore.instance().has_any_objects_for_bucket_including_deleted(bucket)));
    const filtered_pools = pools.filter(async pool =>
        !(await nodes_store.has_any_nodes_for_pool(pool)));
    if (accounts.length || filtered_buckets.length || filtered_pools.length) {
        await system_store.make_changes({
            db_delete: {
                accounts: accounts,
                buckets: filtered_buckets,
                pools: filtered_pools
            }
        });
    }
    dbg.log0(`DB_CLEANER: removed ${accounts.length + filtered_buckets.length + filtered_pools.length} documents from system-store`);
}

// EXPORTS
exports.background_worker = background_worker;
