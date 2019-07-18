/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
// const config = require('../../../config.js');
// const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const KeysLock = require('../../util/keys_lock');
const server_rpc = require('../server_rpc');
const map_deleter = require('./map_deleter');
// const mongo_utils = require('../../util/mongo_utils');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
// const node_allocator = require('../node_services/node_allocator');

const { MapClient } = require('../../sdk/map_client');
const { ChunkDB } = require('./map_db_types');

const builder_lock = new KeysLock();

// dbg.set_level(5);

/**
 *
 * MapBuilder
 *
 * process list of chunk in a batch, and for each one make sure they are well built,
 * meaning that their blocks are available, by creating new blocks and replicating
 * them from accessible blocks, and removing unneeded blocks.
 *
 */
class MapBuilder {

    /**
     * @param {nb.ID[]} chunk_ids 
     * @param {nb.Tier} [move_to_tier]
     */
    constructor(chunk_ids, move_to_tier) {
        this.chunk_ids = chunk_ids;
        this.move_to_tier = move_to_tier;

        /** @type {nb.ID[]} */
        this.second_pass_chunk_ids = [];
    }

    async run() {
        dbg.log0('MapBuilder.run:', 'batch start', this.chunk_ids, 'move_to_tier', this.move_to_tier && this.move_to_tier.name);
        if (!this.chunk_ids.length) return;

        await builder_lock.surround_keys(_.map(this.chunk_ids, String), async () => {

            if (this.move_to_tier) {
                await MDStore.instance().update_chunks_by_ids(this.chunk_ids, { tier: this.move_to_tier._id });
            }
            // we run the build twice. first time to perform all allocation, second time to perform deletions
            await this.run_build(this.chunk_ids);

            // run build a second time on chunks that had future_deletions before but now might delete them
            if (this.second_pass_chunk_ids.length) {
                await this.run_build(this.second_pass_chunk_ids);
            }
        });
    }

    /**
     * @param {nb.ID[]} chunk_ids 
     */
    async run_build(chunk_ids) {
        await system_store.refresh();
        const chunks = await this.reload_chunks(chunk_ids);
        await this.build_chunks(chunks);
    }

    /**
     * In order to get the most relevant data regarding the chunks
     * Note that there is always a possibility that the chunks will cease to exist
     * TODO: We can release the unrelevant chunks from the surround_keys
     * This will allow other batches to run if they wait on non existing chunks
     * @param {nb.ID[]} chunk_ids 
     * @returns {Promise<nb.Chunk[]>}
     */
    async reload_chunks(chunk_ids) {
        const loaded_chunks_db = await MDStore.instance().find_chunks_by_ids(chunk_ids);
        await Promise.all([
            MDStore.instance().load_parts_objects_for_chunks(loaded_chunks_db),
            MDStore.instance().load_blocks_for_chunks(loaded_chunks_db)
        ]);
        /** @type {nb.Chunk[]} */
        const loaded_chunks = loaded_chunks_db.map(chunk_db => new ChunkDB(chunk_db));
        dbg.log1('MapBuilder.reload_chunks:', loaded_chunks);

        const objects_to_delete = [];

        /** @type {nb.Block[]} */
        const blocks_to_delete = [];

        // first look for deleted chunks, and set it's blocks for deletion
        const [deleted_chunks, live_chunks] = _.partition(loaded_chunks, chunk => Boolean(chunk.to_db().deleted));

        // mark all live blocks of deleted chunks for deletion
        for (const chunk of deleted_chunks) {
            for (const frag of chunk.frags) {
                for (const block of frag.blocks) {
                    if (!block.to_db().deleted) {
                        dbg.log0('found unreferenced blocks of a deleted chunk', block);
                        blocks_to_delete.push(block);
                    }
                }
            }
        }

        /** @type {nb.Chunk[] } */
        const chunks_to_delete = [];

        /** @type {nb.Chunk[] } */
        const chunks_to_build = [];

        await P.map(live_chunks, async chunk => {
            try {

                // TODO JACKY handle deleted tier

                // if (!chunk.tier) {
                //     await node_allocator.refresh_tiering_alloc(chunk.bucket.tiering);
                //     const tiering_status = node_allocator.get_tiering_status(chunk.bucket.tiering);
                //     chunk.tier = mapper.select_tier_for_write(chunk.bucket.tiering, tiering_status);
                // }

                if (!chunk.parts || !chunk.parts.length) {
                    dbg.log0('unreferenced chunk to delete', chunk);
                    chunks_to_delete.push(chunk);
                    return;
                }

                // TODO JACKY handle objects in map_builder 
                // chunk leading to a deleted bucket (uncompleted objects doesn't prevent bucket deletion) - chunk should be deleted 
                // test - copy object between buckets - delete source bucket - verify chunks both source and target objects

                // const objects = chunk.to_db().objects;
                // if (!objects || !objects.length) throw new Error('No valid objects are pointing to chunk' + chunk._id);
                // /** @type {nb.ID[]} */
                // const object_bucket_ids = mongo_utils.uniq_ids(objects, 'bucket');
                // /** @type {nb.Bucket[]} */
                // const valid_buckets = _.compact(object_bucket_ids.map(bucket_id => system_store.data.get_by_id(bucket_id)));
                // if (valid_buckets.length > 1) {
                //     dbg.error(`Chunk ${chunk._id} is held by objects from ${object_bucket_ids.length} different buckets`);
                // }
                // if (!valid_buckets.length) {
                //     const res = await system_store.data.get_by_id_include_deleted(chunk.bucket, 'buckets');
                //     /** @type {nb.Bucket} */
                //     const deleted_bucket = res.record;
                //     if (!deleted_bucket) {
                //         //We prefer to leave the option for manual fix if we'll need it
                //         dbg.error(`Chunk ${chunk._id} is held by ${objects.length} invalid objects. The following objects have no valid bucket`, objects);
                //         throw new Error('Chunk held by invalid objects');
                //     }
                //     dbg.warn(`Chunk ${chunk._id} is held by a deleted bucket ${deleted_bucket.name} marking for deletion`);
                //     chunk.bucket = deleted_bucket._id;
                //     objects_to_delete.push(...objects.filter(obj => _.isEqual(obj.bucket, deleted_bucket._id)));
                // }
                // if (!chunk.bucket || !object_bucket_ids.find(id => String(id) === String(chunk.bucket._id))) {
                //     dbg.error('chunk', chunk._id, 'is holding an invalid bucket', chunk.bucket, 'fixing to', valid_buckets[0]);
                //     const valid_bucket = valid_buckets[0]; // This is arbitrary, but there shouldn't be more than one in a healthy system
                //     if (!valid_bucket) {
                //         throw new Error('Could not fix chunk bucket. No suitable bucket found');
                //     }
                //     chunk.bucket = valid_bucket._id;
                //     await MDStore.instance().update_chunk_by_id(chunk._id, { bucket: valid_bucket._id });
                // }

                chunks_to_build.push(chunk);

            } catch (err) {
                dbg.error(`failed to load chunk ${chunk._id} for builder`, err);
            }
        });

        const objects_to_delete_uniq = _.uniqBy(objects_to_delete, obj => obj._id.toHexString());
        const chunks_to_delete_uniq = _.uniqBy(chunks_to_delete, chunk => chunk._id.toHexString());

        dbg.log1('MapBuilder.update_db:',
            'chunks_to_build', chunks_to_build.length,
            'objects_to_delete_uniq', objects_to_delete_uniq.length,
            'chunks_to_delete_uniq', chunks_to_delete_uniq.length,
            'blocks_to_delete', blocks_to_delete.length);

        await Promise.all([
            map_deleter.delete_blocks(blocks_to_delete),
            map_deleter.delete_chunks(chunks_to_delete_uniq),
            // We do not care about the latest flags for objects that do not have a bucket
            objects_to_delete_uniq.map(async obj => {
                try {
                    await MDStore.instance().remove_object_and_unset_latest(obj);
                    await map_deleter.delete_object_mappings(obj);
                } catch (err) {
                    dbg.error('Failed to delete object', obj, 'with error', err);
                }
            }),
        ]);

        return chunks_to_build;
    }

    /**
     * @param {nb.Chunk[]} chunks 
     */
    async build_chunks(chunks) {

        // TODO JACKY check if the populate inside map server is enough

        // const all_blocks = get_all_chunks_blocks(chunks);
        // await P.map(all_blocks, async block => {
        //     const node = await nodes_client.read_node_by_id(system_store.data.systems[0]._id,
        //         block.node_id.toHexString());
        //     block.set_node(node);
        // });

        const mc = new MapClient({
            chunks,
            move_to_tier: this.move_to_tier,
            rpc_client: server_rpc.rpc.new_client({
                auth_token: auth_server.make_auth_token({
                    system_id: system_store.data.systems[0]._id,
                    role: 'admin',
                })
            }),
            desc: 'MapBuilder',
            report_error: async () => {
                // TODO MApClient.report_error
            },

        });
        await mc.run();
        if (mc.had_errors) throw new Error('MapBuilder map errors');
        for (const chunk of mc.chunks) {
            for (const frag of chunk.frags) {
                for (const block of frag.blocks) {
                    if (block.is_future_deletion) {
                        this.second_pass_chunk_ids.push(chunk._id);
                    }
                }
            }
        }
    }

}

exports.MapBuilder = MapBuilder;
