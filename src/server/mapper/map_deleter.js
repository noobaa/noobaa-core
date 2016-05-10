'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var db = require('../db');
var server_rpc = require('../server_rpc');
var nodes_store = require('../node_services/nodes_store');
var mongo_utils = require('../../util/mongo_utils');
var dbg = require('../../util/debug_module')(__filename);


exports.delete_object_mappings = delete_object_mappings;
exports.agent_delete_call = agent_delete_call;


/**
 *
 * delete_object_mappings
 *
 */
function delete_object_mappings(obj) {
    // find parts intersecting the [start,end) range
    var deleted_parts;
    var all_chunk_ids;
    return P.when(db.ObjectPart.collection.find({
            system: obj.system,
            obj: obj._id,
            deleted: null,
        }).toArray())
        .then(parts => mongo_utils.populate(parts, 'chunk', db.DataChunk))
        .then(parts => {
            deleted_parts = parts;
            //Mark parts as deleted
            return db.ObjectPart.collection.updateMany({
                _id: {
                    $in: mongo_utils.uniq_ids(parts, '_id')
                }
            }, {
                $set: {
                    deleted: new Date()
                }
            });
        })
        .then(() => {
            var chunks = _.map(deleted_parts, 'chunk');
            all_chunk_ids = mongo_utils.uniq_ids(chunks, '_id');
            //For every chunk, verify if its no longer referenced
            return db.ObjectPart.collection.find({
                chunk: {
                    $in: all_chunk_ids
                },
                deleted: null,
            }, {
                fields: {
                    chunk: 1
                }
            }).toArray();
        })
        .then(referring_parts => {
            //Seperate non referred chunks
            var referred_chunks_ids = mongo_utils.uniq_ids(referring_parts, 'chunk');
            var non_referred_chunks_ids = mongo_utils.obj_ids_difference(
                all_chunk_ids, referred_chunks_ids);
            dbg.log0("delete_object_mappings: all chunk ids", all_chunk_ids.length,
                "non referenced chunk ids", non_referred_chunks_ids.length);
            //Update non reffered chunks and their blocks as deleted
            var in_chunk_ids = {
                $in: non_referred_chunks_ids
            };
            var set_deleted_time = {
                deleted: new Date()
            };
            return P.join(
                db.DataChunk.collection.updateMany({
                    _id: in_chunk_ids
                }, {
                    $set: set_deleted_time
                }),
                db.DataBlock.collection.updateMany({
                    chunk: in_chunk_ids
                }, {
                    $set: set_deleted_time
                }),
                delete_objects_from_agents(non_referred_chunks_ids)
            );
        });
}


/*
 * delete_objects_from_agents
 * send delete request for the deleted DataBlocks to the agents
 */
function delete_objects_from_agents(deleted_chunk_ids) {
    //Find the deleted data blocks and their nodes
    P.when(db.DataBlock.collection.find({
            chunk: {
                $in: deleted_chunk_ids
            },
            //For now, query deleted as well as this gets executed in
            //delete_object_mappings with P.all along with the DataBlocks
            //deletion update
        }).toArray())
        .then(blocks => nodes_store.populate_nodes_for_map(blocks, 'node'))
        .then(deleted_blocks => {
            //TODO: If the overload of these calls is too big, we should protect
            //ourselves in a similar manner to the replication
            var blocks_by_node = _.groupBy(deleted_blocks, block => block.node._id);
            return P.all(_.map(blocks_by_node, agent_delete_call));
        });
}


/*
 * agent_delete_call
 * calls the agent with the delete API
 */
function agent_delete_call(del_blocks, node_id) {
    var address = del_blocks[0].node.rpc_address;
    var block_ids = _.map(del_blocks, block => block._id.toString());
    dbg.log0('agent_delete_call: node', node_id, address,
        'block_ids', block_ids.length);
    return server_rpc.client.agent.delete_blocks({
        blocks: block_ids
    }, {
        address: address,
        timeout: 30000,
    }).then(() => {
        dbg.log0('agent_delete_call: DONE. node', node_id, address,
            'block_ids', block_ids.length);
    }, err => {
        dbg.log0('agent_delete_call: ERROR node', node_id, address,
            'block_ids', block_ids.length, err);
    });
}
