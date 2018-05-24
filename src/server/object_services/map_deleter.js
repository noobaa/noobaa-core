/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('./md_store').MDStore;
const server_rpc = require('../server_rpc');
const mongo_utils = require('../../util/mongo_utils');

/**
 *
 * delete_object_mappings
 *
 */
function delete_object_mappings(obj) {
    if (!obj) return P.resolve();
    return P.join(
            MDStore.instance().find_parts_chunk_ids(obj),
            MDStore.instance().delete_parts_of_object(obj),
            MDStore.instance().delete_multiparts_of_object(obj)
        )
        .spread(chunk_ids => delete_chunks_if_unreferenced(chunk_ids));
}

function delete_chunks_if_unreferenced(chunk_ids) {
    if (!chunk_ids || !chunk_ids.length) return P.resolve();
    dbg.log2('delete_chunks_if_unreferenced: chunk_ids', chunk_ids);
    return MDStore.instance().find_parts_unreferenced_chunk_ids(chunk_ids)
        .then(unreferenced_chunk_ids => delete_chunks(unreferenced_chunk_ids));
}

function delete_chunks(chunk_ids) {
    if (!chunk_ids || !chunk_ids.length) return P.resolve();
    dbg.log2('delete_chunks: chunk_ids', chunk_ids);
    return P.join(
            MDStore.instance().find_blocks_of_chunks(chunk_ids),
            MDStore.instance().delete_blocks_of_chunks(chunk_ids),
            MDStore.instance().delete_chunks_by_ids(chunk_ids)
        )
        .spread(blocks => delete_blocks_from_nodes(blocks));
}

/*
 * delete_blocks_from_agents
 * send delete request for the deleted DataBlocks to the agents
 */
function delete_blocks_from_nodes(blocks) {
    if (!blocks || !blocks.length) return P.resolve();
    // TODO: If the overload of these calls is too big, we should protect
    // ourselves in a similar manner to the replication
    const blocks_by_node = _.values(_.groupBy(blocks, block => String(block.node._id)));
    return P.map(blocks_by_node, delete_blocks_from_node)
        .then(succeeded_block_ids => {
            const block_ids = _.flatten(succeeded_block_ids).map(block_id => mongo_utils.make_object_id(block_id));
            return MDStore.instance().update_blocks_by_ids(block_ids, { reclaimed: new Date() });
        })
        .catch(err => {
            dbg.warn('delete_blocks_from_nodes: Failed to mark blocks as reclaimed', err);
        })
        .return();
}


/*
 * delete_blocks_from_node
 * calls the agent with the delete API
 */
function delete_blocks_from_node(blocks) {
    if (!blocks || !blocks.length) return P.resolve();
    const node = blocks[0].node;
    const block_ids = _.map(blocks, block => String(block._id));
    dbg.log0('delete_blocks_from_node: node', node._id, node.rpc_address,
        'block_ids', block_ids.length);
    return server_rpc.client.block_store.delete_blocks({
            block_ids: block_ids
        }, {
            address: node.rpc_address,
            timeout: config.IO_DELETE_BLOCK_TIMEOUT,
        })
        .then(res => {
            if (res.failed_block_ids.length) {
                dbg.warn('delete_blocks_from_node: node', node._id, node.rpc_address,
                    'failed_block_ids', res.failed_block_ids.length);
            }
            if (res.succeeded_block_ids.length) {
                dbg.log0('delete_blocks_from_node: node', node._id, node.rpc_address,
                    'succeeded_block_ids', res.succeeded_block_ids.length);
            }
            return res.succeeded_block_ids;
        }, err => {
            dbg.warn('delete_blocks_from_node: ERROR node', node._id, node.rpc_address,
                'block_ids', block_ids.length, err);
        });
}

/*
 * delete_object
 * delete objects mappings and MD
 */
// TODO: Should also throw if did not succeed deleting from the node
function delete_object(obj) {
    if (!obj) return P.resolve();
    return MDStore.instance().delete_object_by_id(obj._id)
        .then(() => delete_object_mappings(obj))
        .return();
}

/*
 * delete_multiple_objects
 * delete multiple bjects mappings and MD
 */
// TODO: Should also throw if did not succeed deleting from the node
function delete_multiple_objects(objects) {
    if (!objects) return P.resolve();
    return P.map(objects, async obj => {
        try {
            await delete_object(obj);
            return { obj };
        } catch (err) {
            dbg.error('delete_multiple_objects failed for obj:', obj, 'with error: ', err);
            return { obj, err };
        }
    }, { concurrency: 10 });
}


// EXPORTS
exports.delete_object = delete_object;
exports.delete_chunks = delete_chunks;
exports.delete_multiple_objects = delete_multiple_objects;
exports.delete_object_mappings = delete_object_mappings;
exports.delete_blocks_from_nodes = delete_blocks_from_nodes;
