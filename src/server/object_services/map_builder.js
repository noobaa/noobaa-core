/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const assert = require('assert');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
// const mapper = require('./mapper');
const MDStore = require('./md_store').MDStore;
const KeysLock = require('../../util/keys_lock');
const server_rpc = require('../server_rpc');
const map_deleter = require('./map_deleter');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
// const node_allocator = require('../node_services/node_allocator');

const { MapClient } = require('../../sdk/map_client');
const { ChunkDB } = require('./map_db_types');

const builder_lock = new KeysLock();

// dbg.set_module_level(5);

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
     * @param {boolean} [evict]
     */
    constructor(chunk_ids, move_to_tier, evict) {
        this.chunk_ids = chunk_ids;
        this.move_to_tier = move_to_tier;
        this.evict = evict;

        // eviction and move to tier are mutually exclusive
        if (evict) assert.strictEqual(move_to_tier, undefined);

        /** @type {nb.ID[]} */
        this.second_pass_chunk_ids = [];
    }

    async run() {
        this.start_run = Date.now();
        dbg.log1('MapBuilder.run:', 'batch start', this.chunk_ids, 'move_to_tier', this.move_to_tier && this.move_to_tier.name);
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


        /** @type {nb.Block[]} */
        const blocks_to_delete = [];

        // first look for deleted chunks, and set it's blocks for deletion
        const [deleted_chunks, live_chunks] = _.partition(loaded_chunks, chunk => Boolean(chunk.to_db().deleted));

        // mark all live blocks of deleted chunks for deletion
        for (const chunk of deleted_chunks) {
            for (const frag of chunk.frags) {
                for (const block of frag.blocks) {
                    if (!block.to_db().deleted) {
                        dbg.log0('found unreferenced blocks of a deleted chunk', block.to_db());
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
                if (this.evict) {
                    chunks_to_delete.push(chunk);
                    return;
                }
                if (!chunk.parts || !chunk.parts.length || !chunk.bucket) {
                    const last_hour = this.start_run - (60 * 60 * 1000); // chunks that were created in the last hour will not be deleted
                    dbg.log0('unreferenced chunk to delete', chunk);
                    if (chunk._id.getTimestamp().getTime() > last_hour) return;
                    chunks_to_delete.push(chunk);
                    return;
                }
                const rotate_checked_chunk = await this.handle_chunk_master_keys(chunk);
                chunks_to_build.push(rotate_checked_chunk);

            } catch (err) {
                dbg.error(`failed to load chunk ${chunk._id} for builder`, err);
            }
        });

        const chunks_to_delete_uniq = _.uniqBy(chunks_to_delete, chunk => chunk._id.toHexString());

        dbg.log1('MapBuilder.update_db:',
            'chunks_to_build', chunks_to_build.length,
            'chunks_to_delete_uniq', chunks_to_delete_uniq.length,
            'blocks_to_delete', blocks_to_delete.length);

        await Promise.all([
            this.evict && map_deleter.delete_parts_by_chunks(chunks_to_delete_uniq),
            map_deleter.delete_blocks(blocks_to_delete),
            map_deleter.delete_chunks(chunks_to_delete_uniq),

        ]);

        // Deleting objects with no parts here as the delete_parts_by_chunks need to finish before
        // any attempt is made to delete the objects.
        if (this.evict) {
            const objects_to_gc = _.uniq(loaded_chunks_db.flatMap(chunk => chunk.objects));
            if (objects_to_gc.length) {
                dbg.log1('MapBuilder.delete_objects_if_no_parts:', objects_to_gc);
                await Promise.all(objects_to_gc.map(map_deleter.delete_object_if_no_parts));
            }
        }
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

    async handle_chunk_master_keys(chunk_db_obj) {

        const chunk = chunk_db_obj.chunk_db;
        const mkm = system_store.master_key_manager;
        const cipher_key_string = chunk.cipher_key && chunk.cipher_key.toString('base64');
        const chunk_master_key_id = chunk.master_key_id && chunk.master_key_id.toString();
        const chunk_m_key = chunk.master_key_id && system_store.data.master_keys.find(
            m_key => m_key._id.toString() === chunk_master_key_id);

        const bucket = system_store.data.buckets.find(buck => buck._id.toString() === chunk.bucket.toString());
        if (!bucket) {
            console.log('chunk.bucket does not exist: ', chunk.bucket);
            return chunk_db_obj;
        }
        const bucket_m_key = bucket.master_key_id;

        // check if chunk master_key is disabled
        if (chunk_m_key && chunk_m_key.disabled === true) {
            const decrypted_cipher_key = mkm.decrypt_value_with_master_key_id(cipher_key_string, chunk_master_key_id);
            await MDStore.instance().update_chunk_by_id(chunk._id, { cipher_key: decrypted_cipher_key}, { master_key_id: 1 });
            chunk.cipher_key = decrypted_cipher_key;
            chunk.master_key_id = undefined;

        // check if chunk master_key is rotated 
        } else if (chunk_master_key_id && bucket_m_key && chunk_master_key_id !== bucket_m_key._id.toString()) {
            const decrypted_cipher_key = mkm.decrypt_value_with_master_key_id(cipher_key_string, chunk_master_key_id);
            const buffer_dec_cipher_key = Buffer.from(decrypted_cipher_key, 'base64');
            const reencrypted_cipher = mkm.encrypt_buffer_with_master_key_id(buffer_dec_cipher_key, bucket_m_key._id);
            await MDStore.instance().update_chunk_by_id(chunk._id,
                { cipher_key: reencrypted_cipher, master_key_id: bucket_m_key._id });
            chunk.cipher_key = reencrypted_cipher;
            chunk.master_key_id = bucket_m_key._id;

        // check if bucket master_key is enabled and chunk master keys disabled
        } else if (!chunk_master_key_id && bucket_m_key && bucket_m_key.disabled === false) {
            // TODO: Or we can check if chunk.cipher_key instanceof mongodb.Binary
            const cipher_key_buffer = config.DB_TYPE === 'postgres' ? chunk.cipher_key : chunk.cipher_key.buffer;
            const encrypted_cipher = mkm.encrypt_buffer_with_master_key_id(cipher_key_buffer, bucket_m_key._id);
            await MDStore.instance().update_chunk_by_id(chunk._id,
                { cipher_key: encrypted_cipher, master_key_id: bucket_m_key._id });
            chunk.cipher_key = encrypted_cipher;
            chunk.master_key_id = bucket_m_key._id;
        }
        return chunk_db_obj;
    }
}

exports.MapBuilder = MapBuilder;
