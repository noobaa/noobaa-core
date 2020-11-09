/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('./md_store').MDStore;
const server_rpc = require('../server_rpc');
const db_client = require('../../util/db_client');
const map_server = require('./map_server');
const { ChunkDB } = require('./map_db_types');
const { get_all_chunks_blocks } = require('../../sdk/map_api_types');
const { get_all_chunk_parts } = require('../../sdk/map_api_types');
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
    if (unreferenced_chunk_ids.length) {
        const chunks_db = await MDStore.instance().find_chunks_by_ids(unreferenced_chunk_ids);
        await MDStore.instance().load_blocks_for_chunks(chunks_db);
        const chunks = chunks_db.map(chunk_db => new ChunkDB(chunk_db));
        await delete_chunks(chunks);
    }
}

/**
 * For eviction in cache buckets we check if there are no parts left
 * and then we can delete the object. A new object md will be allocated
 * if the same object will be cached again later.
 *
 * @param  {nb.ObjectMD} object
 */
async function delete_object_if_no_parts(object) {
    if (!object) return;
    dbg.log1('delete_object_if_no_parts: object_ids', object);
    const has_parts = await MDStore.instance().has_any_parts_for_object(object);
    if (!has_parts) {
        await MDStore.instance().delete_object_by_id(object._id);
    }
}

/**
 * @param {nb.Chunk[]} chunks
 */
async function delete_chunks(chunks) {
    if (!chunks || !chunks.length) return;
    const blocks = get_all_chunks_blocks(chunks).filter(block => !block.to_db().deleted);
    const chunk_ids = chunks.map(chunk => chunk._id);
    dbg.log2('delete_chunks: chunks', chunk_ids);
    await Promise.all([
        MDStore.instance().delete_chunks_by_ids(chunk_ids),
        delete_blocks(blocks),
    ]);
}

/**
 * @param {nb.Block[]} blocks
 */
async function delete_blocks(blocks) {
    if (!blocks || !blocks.length) return;
    try {
        // We should not worry about advancing the delete since there wouldn't be any parallel calls
        // There is only a single builder which will delete the blocks and they won't be called afterwards
        await MDStore.instance().delete_blocks_by_ids(db_client.instance().uniq_ids(blocks, '_id'));
        // Even if we crash here we can assume that the reclaimer will handle the deletions
        await delete_blocks_from_nodes(blocks);
    } catch (error) {
        dbg.error('delete_blocks has error:', error, 'for blocks:', blocks);
        throw error;
    }
}

/**
 * @param {nb.Chunk[]} chunks
 */
async function delete_parts_by_chunks(chunks) {
    if (!chunks || !chunks.length) return;
    const parts = get_all_chunk_parts(chunks).filter(part => !part.to_db().deleted);
    const part_ids = parts.map(part => part._id);
    dbg.log1('delete_parts: parts ', part_ids);
    await MDStore.instance().delete_parts_by_ids(part_ids);
}

/**
 * delete_blocks_from_agents
 * send delete request for the deleted DataBlocks to the agents
 * @param {nb.Block[]} blocks
 */
async function delete_blocks_from_nodes(blocks) {
    if (!blocks || !blocks.length) return;
    await map_server.prepare_blocks(blocks);
    try {
        const blocks_by_node = _.values(_.groupBy(blocks, block => String(block.node._id)));
        const succeeded_block_ids = await Promise.all(blocks_by_node.map(delete_blocks_from_node));
        const block_ids = _.flatten(succeeded_block_ids).map(block_id => db_client.instance().parse_object_id(block_id));
        // In case we have a bug which calls delete_blocks_from_nodes several times
        // We will advance the reclaimed and it will have different values
        // This is not critical like deleted which alters the md_aggregator calculations
        await MDStore.instance().update_blocks_by_ids(block_ids, { reclaimed: new Date() });
    } catch (err) {
        dbg.warn('delete_blocks_from_nodes: Failed to mark blocks as reclaimed', err);
    }
}

/**
 * delete_blocks_from_node
 * calls the agent with the delete API
 * @param {nb.Block[]} blocks
 */
async function delete_blocks_from_node(blocks) {
    if (!blocks || !blocks.length) return [];
    const node = blocks[0].node;
    const block_ids = _.map(blocks, block => String(block._id));
    if (!node.rpc_address) {
        dbg.warn('delete_blocks_from_node: no address for node', node._id, node.name,
            'block_ids', block_ids.length);
        return [];
    }
    dbg.log0('delete_blocks_from_node: node', node._id, node.rpc_address,
        'block_ids', block_ids.length);
    try {
        const res = await server_rpc.client.block_store.delete_blocks({ block_ids }, {
            address: node.rpc_address,
            timeout: config.IO_DELETE_BLOCK_TIMEOUT,
        });
        if (res.failed_block_ids && res.failed_block_ids.length) {
            dbg.warn('delete_blocks_from_node: node', node._id, node.rpc_address,
                'failed_block_ids', res.failed_block_ids.length);
        }
        if (res.succeeded_block_ids && res.succeeded_block_ids.length) {
            dbg.log0('delete_blocks_from_node: node', node._id, node.rpc_address,
                'succeeded_block_ids', res.succeeded_block_ids.length);
        }
        return res.succeeded_block_ids || [];
    } catch (err) {
        dbg.warn('delete_blocks_from_node: ERROR node', node._id, node.rpc_address,
            'block_ids', block_ids.length, err);
        return [];
    }
}

// EXPORTS
exports.delete_object_mappings = delete_object_mappings;
exports.delete_object_if_no_parts = delete_object_if_no_parts;
exports.delete_chunks_if_unreferenced = delete_chunks_if_unreferenced;
exports.delete_chunks = delete_chunks;
exports.delete_blocks = delete_blocks;
exports.delete_parts_by_chunks = delete_parts_by_chunks;
exports.delete_blocks_from_nodes = delete_blocks_from_nodes;
