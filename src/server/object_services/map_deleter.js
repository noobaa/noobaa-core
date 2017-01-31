/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('./md_store').MDStore;
const server_rpc = require('../server_rpc');

/**
 *
 * delete_object_mappings
 *
 */
function delete_object_mappings(obj) {
    const delete_date = new Date();
    return P.join(
            MDStore.instance().find_parts_chunk_ids(obj),
            MDStore.instance().delete_parts_of_object(obj, delete_date),
            MDStore.instance().delete_multiparts_of_object(obj, delete_date)
        )
        .spread(chunk_ids => delete_chunks_if_unreferenced(chunk_ids, delete_date));
}

function delete_chunks_if_unreferenced(chunk_ids, delete_date) {
    return MDStore.instance().find_parts_unreferenced_chunk_ids(chunk_ids)
        .then(unreferenced_chunk_ids => delete_chunks(unreferenced_chunk_ids, delete_date));
}

function delete_chunks(chunk_ids, delete_date) {
    return P.join(
            MDStore.instance().find_blocks_of_chunks(chunk_ids),
            MDStore.instance().delete_blocks_of_chunks(chunk_ids, delete_date),
            MDStore.instance().delete_chunks_by_ids(chunk_ids, delete_date)
        )
        .spread(blocks => delete_blocks_from_nodes(blocks));
}

/*
 * delete_blocks_from_agents
 * send delete request for the deleted DataBlocks to the agents
 */
function delete_blocks_from_nodes(blocks) {
    // TODO: If the overload of these calls is too big, we should protect
    // ourselves in a similar manner to the replication
    const blocks_by_node = _.values(_.groupBy(blocks, block => String(block.node._id)));
    return P.map(blocks_by_node, delete_blocks_from_node);
}


/*
 * delete_blocks_from_node
 * calls the agent with the delete API
 */
function delete_blocks_from_node(blocks) {
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
        .then(() => {
            dbg.log0('delete_blocks_from_node: DONE. node', node._id, node.rpc_address,
                'block_ids', block_ids.length);
        }, err => {
            dbg.log0('delete_blocks_from_node: ERROR node', node._id, node.rpc_address,
                'block_ids', block_ids.length, err);
        });
}


// EXPORTS
exports.delete_object_mappings = delete_object_mappings;
exports.delete_blocks_from_nodes = delete_blocks_from_nodes;
