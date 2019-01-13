/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('./md_store').MDStore;
const server_rpc = require('../server_rpc');
const mongo_utils = require('../../util/mongo_utils');
const nodes_client = require('../node_services/nodes_client');
const { BlockDB } = require('./map_db_types');
/**
 *
 * delete_object_mappings
 * @param {nb.ObjectMD} obj
 */
async function delete_object_mappings(obj) {
    if (!obj || obj.delete_marker) return;
    const [chunk_ids] = await Promise.all([
        MDStore.instance().find_parts_chunk_ids(obj),
        MDStore.instance().delete_parts_of_object(obj),
        MDStore.instance().delete_multiparts_of_object(obj),
    ]);
    await delete_chunks_if_unreferenced(chunk_ids);
}

/**
 * @param {nb.ID[]} chunk_ids 
 */
async function delete_chunks_if_unreferenced(chunk_ids) {
    if (!chunk_ids || !chunk_ids.length) return;
    dbg.log2('delete_chunks_if_unreferenced: chunk_ids', chunk_ids);
    const unreferenced_chunk_ids = await MDStore.instance().find_parts_unreferenced_chunk_ids(chunk_ids);
    await delete_chunks(unreferenced_chunk_ids);
}

/**
 * @param {nb.ID[]} chunk_ids 
 */
async function delete_chunks(chunk_ids) {
    if (!chunk_ids || !chunk_ids.length) return;
    dbg.log2('delete_chunks: chunk_ids', chunk_ids);
    const [blocks_db] = await Promise.all([
        MDStore.instance().find_blocks_of_chunks(chunk_ids),
        MDStore.instance().delete_blocks_of_chunks(chunk_ids),
        MDStore.instance().delete_chunks_by_ids(chunk_ids),
    ]);
    const blocks = blocks_db.map(block_db => new BlockDB(block_db));
    if (blocks.length) {
        await nodes_client.instance().populate_nodes_for_map(blocks[0].system._id, blocks, 'node_id', 'node');
    }
    await delete_blocks_from_nodes(blocks);
}

/**
 * delete_blocks_from_agents
 * send delete request for the deleted DataBlocks to the agents
 * @param {nb.Block[]} blocks
 */
async function delete_blocks_from_nodes(blocks) {
    if (!blocks || !blocks.length) return;
    try {
        const blocks_by_node = _.values(_.groupBy(blocks, block => String(block.node._id)));
        const succeeded_block_ids = await Promise.all(blocks_by_node.map(delete_blocks_from_node));
        const block_ids = _.flatten(succeeded_block_ids).map(block_id => mongo_utils.parse_object_id(block_id));
        // In case we have a bug which calls delete_blocks_from_nodes several times
        // We will advance the reclaimed and it will have different values
        // This is not critical like deleted which alters the md_aggregator calculations
        await MDStore.instance().update_blocks_by_ids(block_ids, { reclaimed: new Date() });
    } catch (err) {
        dbg.warn('delete_blocks_from_nodes: Failed to mark blocks as reclaimed', err);
    }
}

/**
 * @param {nb.Block[]} blocks
 */
async function builder_delete_blocks(blocks) {
    if (!blocks || !blocks.length) return;
    try {
        // We should not worry about advancing the delete since there wouldn't be any parallel calls
        // There is only a single builder which will delete the blocks and they won't be called afterwards
        await MDStore.instance().update_blocks_by_ids(mongo_utils.uniq_ids(blocks, '_id'), { deleted: new Date() });
        // Even if we crash here we can assume that the reclaimer will handle the deletions
        await delete_blocks_from_nodes(blocks);
    } catch (error) {
        dbg.error('builder_delete_blocks has error:', error, 'for blocks:', blocks);
        throw error;
    }
}

/**
 * delete_blocks_from_node
 * calls the agent with the delete API
 * @param {nb.Block[]} blocks
 */
async function delete_blocks_from_node(blocks) {
    if (!blocks || !blocks.length) return;
    const node = blocks[0].node;
    const block_ids = _.map(blocks, block => String(block._id));
    dbg.log0('delete_blocks_from_node: node', node._id, node.rpc_address,
        'block_ids', block_ids.length);
    try {
        const res = await server_rpc.client.block_store.delete_blocks({ block_ids }, {
            address: node.rpc_address,
            timeout: config.IO_DELETE_BLOCK_TIMEOUT,
        });
        if (res.failed_block_ids.length) {
            dbg.warn('delete_blocks_from_node: node', node._id, node.rpc_address,
                'failed_block_ids', res.failed_block_ids.length);
        }
        if (res.succeeded_block_ids.length) {
            dbg.log0('delete_blocks_from_node: node', node._id, node.rpc_address,
                'succeeded_block_ids', res.succeeded_block_ids.length);
        }
        return res.succeeded_block_ids;
    } catch (err) {
        dbg.warn('delete_blocks_from_node: ERROR node', node._id, node.rpc_address,
            'block_ids', block_ids.length, err);
    }
}

// EXPORTS
exports.delete_object_mappings = delete_object_mappings;
exports.delete_chunks_if_unreferenced = delete_chunks_if_unreferenced;
exports.delete_chunks = delete_chunks;
exports.delete_blocks_from_nodes = delete_blocks_from_nodes;
exports.builder_delete_blocks = builder_delete_blocks;
