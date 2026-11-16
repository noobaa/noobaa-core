/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('./md_store').MDStore;
const server_rpc = require('../server_rpc');
const db_client = require('../../util/db_client');
const { ChunkDB } = require('./map_db_types');
const { get_all_chunks_blocks } = require('../../sdk/map_api_types');
const { get_all_chunk_parts } = require('../../sdk/map_api_types');
const block_store_client = require('../../agent/block_store_services/block_store_client');
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
 * Soft-delete parts and unreferenced chunks only (no multiparts)
 * Used when clearing a temporary STANDARD restore copy so archive MPU multipart MD is preserved
 * It is a copy of delete_object_mappings but without deleting multiparts
 * @param {nb.ObjectMD} obj
 */
async function delete_object_parts(obj) {
    if (!obj || obj.delete_marker) return;
    const [chunk_ids] = await Promise.all([
        MDStore.instance().find_parts_chunk_ids(obj),
        MDStore.instance().delete_parts_of_object(obj),
    ]);
    await delete_chunks_if_unreferenced(chunk_ids);
}

/**
 * Soft-delete multipart MD only (no parts/chunks). Used for remote-archive
 * objects that never had a local restore copy (e.g. aborted archive MPU).
 * @param {nb.ObjectMD} obj
 */
async function delete_object_multiparts(obj) {
    if (!obj || obj.delete_marker) return;
    await MDStore.instance().delete_multiparts_of_object(obj);
}

/**
 * Delete local data mappings for LifecycleReclaimer paths:
 * expired restore copies, and unreclaimed transition source copies.
 * Removes parts/chunks and multiparts referenced by those parts.
 * Leaves MD-only archive multiparts untouched so deep-archive data remains addressable.
 * @param {nb.ObjectMD} obj
 */
async function delete_object_mappings_for_expired_restore_or_transition(obj) {
    if (!obj || obj.delete_marker) return;
    const parts = await MDStore.instance().find_all_parts_of_object(obj);
    const chunk_ids = db_client.instance().uniq_ids(parts, 'chunk');
    // Soft-delete only multiparts referenced by local parts (keep MD-only archive multiparts).
    const multiparts = parts.filter(part => part.multipart).map(part => ({ _id: part.multipart }));
    await Promise.all([
        MDStore.instance().delete_parts_of_object(obj),
        multiparts.length && MDStore.instance().delete_multiparts(multiparts),
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
        // Only mark blocks as deleted in the DB.
        // Actual deletion from agents/cloud is handled by agent_blocks_reclaimer in controlled batches.
        await MDStore.instance().delete_blocks_by_ids(db_client.instance().uniq_ids(blocks, '_id'));
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
 * delete_blocks_from_nodes
 * send delete request for the deleted DataBlocks to the agents/cloud.
 * Blocks must already be prepared (node info populated) by the caller
 * (agent_blocks_reclaimer calls prepare_blocks_from_db before this).
 * @param {nb.Block[]} blocks
 */
async function delete_blocks_from_nodes(blocks) {
    if (!blocks || !blocks.length) return;
    try {
        const blocks_by_node = _.values(_.groupBy(blocks, block => String(block.node._id)));
        const succeeded_block_ids = await Promise.all(blocks_by_node.map(delete_blocks_from_node));
        const block_ids = _.flatten(succeeded_block_ids).map(block_id => db_client.instance().parse_object_id(block_id));
        await MDStore.instance().update_blocks_by_ids(block_ids, { reclaimed: new Date() });
    } catch (err) {
        dbg.warn('delete_blocks_from_nodes: Failed to mark blocks as reclaimed', err);
    }
}

/**
 * delete_blocks_from_node
 * Routes deletion through block_store_client which handles cloud pools
 * directly (S3/Azure/Google SDK) and FS pools via agent RPC.
 * @param {nb.Block[]} blocks
 */
async function delete_blocks_from_node(blocks) {
    if (!blocks || !blocks.length) return [];
    const node = blocks[0].node;
    const block_mds = blocks.map(block => block.to_block_md());
    if (!node.rpc_address) {
        dbg.warn('delete_blocks_from_node: no address for node', node._id, node.name,
            'block_mds', block_mds.length);
        return [];
    }
    dbg.log0('delete_blocks_from_node: node', node._id, node.rpc_address,
        'block_mds', block_mds.length);
    try {
        const res = await block_store_client.instance().delete_blocks(
            server_rpc.client,
            block_mds,
            { address: node.rpc_address, timeout: config.IO_DELETE_BLOCK_TIMEOUT }
        );
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
            'block_mds', block_mds.length, err);
        return [];
    }
}

// Phase A. Soft-delete live parts and multiparts of deleted, not-yet-reclaimed objects.
// No chunk updates and no reclaimed mark: a crash here must leave the chunk ids on the part rows.
const soft_delete_mappings_sql = `
WITH deleted_objects AS (
    SELECT data->>'_id' AS id
    FROM objectmds
    WHERE data->>'_id' = ANY($2::text[])
      AND data ? 'deleted'
      AND (data->'reclaimed' IS NULL OR data->'reclaimed' = 'null'::jsonb)
),
soft_parts AS (
    UPDATE objectparts
    SET data = jsonb_set(data, '{deleted}', to_jsonb($1::text), true)
    FROM deleted_objects
    WHERE objectparts.data->>'obj' = deleted_objects.id
      AND objectparts.data ? 'obj'
      AND (objectparts.data->'deleted' IS NULL OR objectparts.data->'deleted' = 'null'::jsonb)
    RETURNING 1
),
soft_multiparts AS (
    UPDATE objectmultiparts
    SET data = jsonb_set(data, '{deleted}', to_jsonb($1::text), true)
    FROM deleted_objects
    WHERE objectmultiparts.data->>'obj' = deleted_objects.id
      AND objectmultiparts.data ? 'obj'
      AND (objectmultiparts.data->'deleted' IS NULL OR objectmultiparts.data->'deleted' = 'null'::jsonb)
    RETURNING 1
)
SELECT
    (SELECT count(*)::int FROM soft_parts) AS parts,
    (SELECT count(*)::int FROM soft_multiparts) AS multiparts`;

// Phase B. Runs only after phase A has committed, so this snapshot sees those soft-deletes.
// The DELETEs below are not visible to the NOT EXISTS; they do not need to be, because a
// soft-deleted part fails the live predicate. Do not wrap this with phase A in one transaction.
const reclaim_mappings_sql = `
WITH deleted_objects AS (
    SELECT data->>'_id' AS id
    FROM objectmds
    WHERE data->>'_id' = ANY($2::text[])
      AND data ? 'deleted'
      AND (data->'reclaimed' IS NULL OR data->'reclaimed' = 'null'::jsonb)
),
removed_parts AS (
    DELETE FROM objectparts
    USING deleted_objects
    WHERE objectparts.data->>'obj' = deleted_objects.id
      AND objectparts.data ? 'obj'
      AND objectparts.data ? 'deleted'
      AND objectparts.data->>'deleted' IS NOT NULL
    RETURNING objectparts.data->>'chunk' AS chunk_id
),
removed_multiparts AS (
    DELETE FROM objectmultiparts
    USING deleted_objects
    WHERE objectmultiparts.data->>'obj' = deleted_objects.id
      AND objectmultiparts.data ? 'obj'
      AND objectmultiparts.data ? 'deleted'
      AND objectmultiparts.data->>'deleted' IS NOT NULL
    RETURNING 1
),
unreferenced AS (
    SELECT DISTINCT r.chunk_id
    FROM removed_parts r
    WHERE r.chunk_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM objectparts p
          WHERE p.data->>'chunk' = r.chunk_id
            AND p.data ? 'chunk'
            AND (p.data->'deleted' IS NULL OR p.data->'deleted' = 'null'::jsonb)
          OFFSET 0
      )
),
deleted_chunks AS (
    UPDATE datachunks
    SET data = (jsonb_set(data, '{deleted}', to_jsonb($1::text), true) - 'dedup_key')
    FROM unreferenced
    WHERE datachunks.data->>'_id' = unreferenced.chunk_id
    RETURNING datachunks.data->>'_id' AS id
),
deleted_blocks AS (
    UPDATE datablocks
    SET data = jsonb_set(data, '{deleted}', to_jsonb($1::text), true)
    FROM (
        SELECT b.ctid
        FROM deleted_chunks c
        JOIN LATERAL (
            SELECT b.ctid
            FROM datablocks b
            WHERE b.data->>'chunk' = c.id
              AND b.data ? 'chunk'
              AND (b.data->'deleted' IS NULL OR b.data->'deleted' = 'null'::jsonb)
            OFFSET 0
        ) b ON true
    ) hits
    WHERE datablocks.ctid = hits.ctid
    RETURNING 1
),
marked AS (
    UPDATE objectmds
    SET data = jsonb_set(data, '{reclaimed}', to_jsonb($1::text), true)
    FROM deleted_objects d
    WHERE objectmds.data->>'_id' = d.id
      AND NOT EXISTS (
          SELECT 1
          FROM objectparts p
          WHERE p.data->>'obj' = d.id
            AND p.data ? 'obj'
            AND (p.data->'deleted' IS NULL OR p.data->'deleted' = 'null'::jsonb)
          OFFSET 0
      )
      AND NOT EXISTS (
          SELECT 1
          FROM objectmultiparts m
          WHERE m.data->>'obj' = d.id
            AND m.data ? 'obj'
            AND (m.data->'deleted' IS NULL OR m.data->'deleted' = 'null'::jsonb)
          OFFSET 0
      )
    RETURNING 1
)
SELECT
    (SELECT count(*)::int FROM removed_parts) AS parts,
    (SELECT count(*)::int FROM removed_multiparts) AS multiparts,
    (SELECT count(*)::int FROM deleted_blocks) AS blocks,
    (SELECT count(*)::int FROM marked) AS objects`;

/**
 * Phase A. Soft-delete live parts and multiparts. Does not mark the objects reclaimed.
 * @param {string[]} objs
 * @returns {Promise<{ parts: number, multiparts: number }>}
 */
async function soft_delete_mappings_of_objects(objs) {
    if (!objs || !objs.length) return { parts: 0, multiparts: 0 };
    const res = await db_client.instance().executeSQL(soft_delete_mappings_sql, [new Date().toISOString(), objs]);
    dbg.log1('soft_delete_mappings_of_objects', objs.length, res.rows[0]);
    return res.rows[0];
}

/**
 * Phase B. Ref-check chunks of the already soft-deleted parts, soft-delete unreferenced
 * chunks and their blocks, hard-delete the parts and multiparts, and mark the objects reclaimed.
 * Leaves an object unreclaimed when it still has a live part or multipart.
 * @param {string[]} objs
 * @returns {Promise<{ parts: number, multiparts: number, blocks: number, objects: number }>}
 */
async function reclaim_mappings_of_objects(objs) {
    if (!objs || !objs.length) return { parts: 0, multiparts: 0, blocks: 0, objects: 0 };
    const res = await db_client.instance().executeSQL(reclaim_mappings_sql, [new Date().toISOString(), objs]);
    dbg.log1('reclaim_mappings_of_objects', objs.length, res.rows[0]);
    return res.rows[0];
}

/**
 * Reclaim standard-object mappings for a batch of object ids.
 * Two commits: soft-delete the parts, then ref-check. One statement, or both
 * statements in one transaction, shares a snapshot and can leak a shared chunk.
 * @param {string[]} objs
 */
async function delete_mapping_batch(objs) {
    if (!objs || !objs.length) return;
    await soft_delete_mappings_of_objects(objs);
    await reclaim_mappings_of_objects(objs);
}

// EXPORTS
exports.delete_object_mappings = delete_object_mappings;
exports.delete_object_parts = delete_object_parts;
exports.delete_object_multiparts = delete_object_multiparts;
exports.delete_object_mappings_for_expired_restore_or_transition = delete_object_mappings_for_expired_restore_or_transition;
exports.delete_object_if_no_parts = delete_object_if_no_parts;
exports.delete_chunks_if_unreferenced = delete_chunks_if_unreferenced;
exports.delete_chunks = delete_chunks;
exports.delete_blocks = delete_blocks;
exports.delete_parts_by_chunks = delete_parts_by_chunks;
exports.delete_blocks_from_nodes = delete_blocks_from_nodes;
exports.delete_mapping_batch = delete_mapping_batch;
exports.soft_delete_mappings_of_objects = soft_delete_mappings_of_objects;
exports.reclaim_mappings_of_objects = reclaim_mappings_of_objects;
