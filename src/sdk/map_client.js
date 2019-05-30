/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('./nb')} nb */

const util = require('util');
const crypto = require('crypto');
const assert = require('assert');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const nb_native = require('../util/nb_native');
const LRUCache = require('../util/lru_cache');
const Semaphore = require('../util/semaphore');
const KeysSemaphore = require('../util/keys_semaphore');
const block_store_client = require('../agent/block_store_services/block_store_client').instance();

const { ChunkAPI } = require('./map_api_types');
const { RpcError, RPC_BUFFERS } = require('../rpc');

// semphores global to the client
const block_write_sem_global = new Semaphore(config.IO_WRITE_CONCURRENCY_GLOBAL);
const block_replicate_sem_global = new Semaphore(config.IO_REPLICATE_CONCURRENCY_GLOBAL);
const block_read_sem_global = new Semaphore(config.IO_READ_CONCURRENCY_GLOBAL);

// semphores specific to an agent
const block_write_sem_agent = new KeysSemaphore(config.IO_WRITE_CONCURRENCY_AGENT);
const block_replicate_sem_agent = new KeysSemaphore(config.IO_REPLICATE_CONCURRENCY_AGENT);
const block_read_sem_agent = new KeysSemaphore(config.IO_READ_CONCURRENCY_AGENT);

const chunk_read_cache = new LRUCache({
    name: 'ChunkReadCache',
    max_usage: 256 * 1024 * 1024, // 128 MB

    /**
     * @param {Buffer} data
     * @returns {number}
     */
    item_usage(data) {
        return (data && data.length) || 1024;
    },

    /**
     * @param {{ key: string, load_chunk: () => Promise<Buffer> }} params
     * @returns {string}
     */
    make_key({ key }) {
        return key;
    },

    /**
     * @param {{ key: string, load_chunk: () => Promise<Buffer> }} params
     * @returns {Promise<Buffer>}
     */
    async load({ load_chunk }) {
        return load_chunk();
    },
});


/**
 * @param {nb.Chunk[]} res_chunks
 * @param {nb.Chunk[]} chunks
 */
function map_frag_data(res_chunks, chunks) {
    for (let i = 0; i < res_chunks.length; ++i) {
        const res_chunk = res_chunks[i];
        const chunk = chunks[i];
        for (const res_frag of res_chunk.frags) {
            const frag = chunk.frag_by_index[res_frag.frag_index];
            // get the buffer from the input chunks
            res_frag.data = frag.data;
        }
    }
}

class MapClient {

    /**
     * @param {Object} props
     * @param {nb.Chunk[]} [props.chunks]
     * @param {nb.ObjectInfo} [props.object_md]
     * @param {number} [props.read_start]
     * @param {number} [props.read_end]
     * @param {nb.LocationInfo} [props.location_info]
     * @param {nb.Tier} [props.move_to_tier]
     * @param {boolean} [props.check_dups]
     * @param {boolean} [props.verification_mode]
     * @param {Object} props.rpc_client
     * @param {string} [props.desc]
     * @param { (block_md: nb.BlockMD, action: 'write'|'replicate'|'read', err: Error) => Promise<void> } props.report_error
     */
    constructor(props) {
        this.chunks = props.chunks;
        this.object_md = props.object_md;
        this.read_start = props.read_start;
        this.read_end = props.read_end;
        this.location_info = props.location_info;
        this.move_to_tier = props.move_to_tier;
        this.check_dups = Boolean(props.check_dups);
        this.rpc_client = props.rpc_client;
        this.desc = props.desc;
        this.report_error = props.report_error;
        this.had_errors = false;
        this.verification_mode = props.verification_mode || false;
        Object.seal(this);
    }

    async run() {
        const chunks = await this.get_mapping();
        this.chunks = chunks;
        await this.process_mapping();
        await this.put_mapping();
    }

    /**
     * object_server.put_mapping will handle:
     * - allocations
     * - make_room_in_tier
     * @param {nb.Chunk[]} chunks
     * @returns {Promise<nb.Chunk[]>}
     */
    async get_mapping(chunks = this.chunks) {

        const res = await this.rpc_client.object.get_mapping({
            chunks: chunks.map(chunk => chunk.to_api()),
            location_info: this.location_info,
            move_to_tier: this.move_to_tier && this.move_to_tier._id,
            check_dups: this.check_dups,
        });
        /** @type {nb.Chunk[]} */
        const res_chunks = res.chunks.map(chunk_info => new ChunkAPI(chunk_info));
        map_frag_data(res_chunks, chunks);
        return res_chunks;
    }

    /**
     * object_server.put_mapping will handle:
     * - deletions
     * - update_db
     */
    async put_mapping() {
        // TODO should we filter out chunk.had_errors from put mapping?
        await this.rpc_client.object.put_mapping({
            chunks: this.chunks.filter(chunk => !chunk.had_errors).map(chunk => chunk.to_api()),
            move_to_tier: this.move_to_tier && this.move_to_tier._id,
        });
    }

    /**
     * @returns {Promise<void>}
     */
    async process_mapping() {
        /** @type {nb.Chunk[]} */
        const chunks = await P.map(this.chunks, async chunk => {
            try {
                return await this.process_chunk(chunk);
            } catch (err) {
                chunk.had_errors = true;
                this.had_errors = true;
                dbg.warn('MapClient.process_mapping: chunk ERROR',
                    err.stack || err, 'chunk', chunk,
                    err.chunks ? 'err.chunks ' + util.inspect(err.chunks) : '',
                );
                return chunk;
            }
        });
        this.chunks = chunks;
    }

    /**
     * @param {nb.Chunk} chunk 
     * @returns {Promise<nb.Chunk>}
     */
    async process_chunk(chunk) {
        dbg.log1('MapClient.process_chunk:', chunk);

        if (chunk.dup_chunk_id) return chunk;

        if (chunk.is_building_frags) {
            await this.read_chunk(chunk);
            await this.encode_chunk(chunk);
        }

        const call_process_frag = frag => this.process_frag(chunk, frag);
        const start_time = Date.now();
        let done = false;
        while (!done) {
            try {
                await P.map(chunk.frags, call_process_frag);
                done = true;
            } catch (err) {
                if (chunk.had_errors) throw err;
                if (Date.now() - start_time > config.IO_WRITE_PART_ATTEMPTS_EXHAUSTED) {
                    dbg.error('UPLOAD:', 'write part attempts exhausted', err);
                    throw err;
                }
                dbg.warn('UPLOAD:', 'write part reallocate on ERROR', err);
                const [chunk_map] = await this.get_mapping([chunk]);
                chunk = chunk_map;
                if (chunk.dup_chunk_id) return chunk;
            }
        }
        return chunk;
    }

    /**
     * @param {nb.Chunk} chunk 
     * @param {nb.Frag} frag 
     */
    async process_frag(chunk, frag) {
        if (!frag.allocations || !frag.allocations.length) return;

        // upload case / fragment rebuild case
        if (frag.data) {
            const first_alloc = frag.allocations[0];
            const rest_allocs = frag.allocations.slice(1);
            await this.retry_write_block(first_alloc.block_md, frag.data);
            await P.map(rest_allocs, alloc => this.retry_replicate_blocks(alloc.block_md, first_alloc.block_md));
            return;
        }

        const accessible_blocks = frag.blocks.filter(block => block.is_accessible);
        if (accessible_blocks && accessible_blocks.length) {
            let next_source = Math.floor(Math.random() * accessible_blocks.length);
            await P.map(frag.allocations, async alloc => {
                const source_block = accessible_blocks[next_source];
                next_source = (next_source + 1) % accessible_blocks.length;
                return this.retry_replicate_blocks(alloc.block_md, source_block.to_block_md());
            });
            return;
        }

        // we already know that this chunk cannot be read here
        // because we already handled missing frags 
        // and now we still have a frag without data source.
        // so we mark the chunk.had_errors to break from the process_frag loop.
        chunk.had_errors = true;
        this.had_errors = true;
        throw new Error(`No data source for frag ${frag._id}`);
    }

    /**
     * retry the write operation
     * once retry exhaust we report and throw an error
     * @param {nb.BlockMD} block_md
     * @param {Buffer} buffer
     */
    async retry_write_block(block_md, buffer) {
        let done = false;
        let retries = 0;
        while (!done) {
            try {
                await this.write_block(block_md, buffer);
                done = true;
            } catch (err) {
                await this.report_error(block_md, 'write', err);
                if (err.rpc_code === 'NO_BLOCK_STORE_SPACE') throw err;
                retries += 1;
                if (retries > config.IO_WRITE_BLOCK_RETRIES) throw err;
                await P.delay(config.IO_WRITE_RETRY_DELAY_MS);
            }
        }
    }

    /**
     * retry the replicate operations
     * once any retry exhaust we report and throw an error
     * @param {nb.BlockMD} block_md
     * @param {nb.BlockMD} source_block_md
     */
    async retry_replicate_blocks(block_md, source_block_md) {
        let done = false;
        let retries = 0;
        while (!done) {
            try {
                await this.replicate_block(block_md, source_block_md);
                done = true;
            } catch (err) {
                await this.report_error(block_md, 'replicate', err);
                if (err.rpc_code === 'NO_BLOCK_STORE_SPACE') throw err;
                retries += 1;
                if (retries > config.IO_REPLICATE_BLOCK_RETRIES) throw err;
                await P.delay(config.IO_REPLICATE_RETRY_DELAY_MS);
            }
        }
    }

    /**
     * write a block to the storage node
     * limit writes per agent + global IO semaphore to limit concurrency
     * @param {nb.BlockMD} block_md
     * @param {Buffer} buffer
     */
    async write_block(block_md, buffer) {
        await block_write_sem_agent.surround_key(String(block_md.node), async () =>
            block_write_sem_global.surround(async () => {
                dbg.log1('UPLOAD:', this.desc, 'write block',
                    'buffer', buffer.length,
                    'to', block_md.id, 'node', block_md.node, block_md.address);

                this._error_injection_on_write();

                return block_store_client.write_block(this.rpc_client, {
                    block_md,
                    [RPC_BUFFERS]: { data: buffer },
                }, {
                    address: block_md.address,
                    timeout: config.IO_WRITE_BLOCK_TIMEOUT,
                    auth_token: null // ignore the client options when talking to agents
                });
            }));
    }

    /**
     * write a block to the storage node
     * limit replicates per agent + Global IO semaphore to limit concurrency
     * @param {nb.BlockMD} block_md
     * @param {nb.BlockMD} source_block_md
     */
    async replicate_block(block_md, source_block_md) {
        await block_replicate_sem_agent.surround_key(String(block_md.node), async () =>
            block_replicate_sem_global.surround(async () => {
                dbg.log1('UPLOAD:', this.desc, 'replicate block',
                    'from', source_block_md.id, 'node', source_block_md.node, source_block_md.address,
                    'to', block_md.id, 'node', block_md.node, block_md.address);

                this._error_injection_on_write();

                return this.rpc_client.block_store.replicate_block({
                    target: block_md,
                    source: source_block_md,
                }, {
                    address: block_md.address,
                    timeout: config.IO_REPLICATE_BLOCK_TIMEOUT,
                });
            }));
    }

    async run_read_object() {
        this.chunks = await this.read_object_mapping();
        await this.read_chunks();
    }

    /**
     * @returns {Promise<nb.Chunk[]>}
     */
    async read_object_mapping() {
        const res = await this.rpc_client.object.read_object_mapping({
            obj_id: this.object_md.obj_id,
            bucket: this.object_md.bucket,
            key: this.object_md.key,
            start: this.read_start,
            end: this.read_end,
            location_info: this.location_info,
        });
        return res.chunks.map(chunk_info => {
            // TODO: Maybe move this to map_reader?
            if (this.object_md.encryption && this.object_md.encryption.key_b64) {
                chunk_info.cipher_key_b64 = this.object_md.encryption.key_b64;
            }
            return new ChunkAPI(chunk_info);
        });
    }
    /**
     * @returns {Promise<void>}
     */
    async read_chunks() {
        await P.map(this.chunks, async chunk => {
            try {
                return await this.read_chunk(chunk);
            } catch (err) {
                chunk.had_errors = true;
                this.had_errors = true;
                dbg.warn('MapClient.read_chunks: chunk ERROR',
                    err.stack || err, 'chunk', chunk,
                    err.chunks ? 'err.chunks ' + util.inspect(err.chunks) : '',
                );
            }
        });
    }

    /**
     * @param {nb.Chunk} chunk
     */
    async read_chunk(chunk) {
        if (this.verification_mode) {
            await this.read_chunk_data(chunk);
        } else {
            const cached_data = await chunk_read_cache.get_with_cache({
                key: chunk._id.toHexString(),
                load_chunk: async () => {
                    await this.read_chunk_data(chunk);
                    return chunk.data;
                },
            });
            if (!chunk.data) chunk.data = cached_data;
        }
    }

    async read_chunk_data(chunk) {
        const all_frags = chunk.frags;
        const data_frags = all_frags.filter(frag => frag.data_index >= 0);

        // start by reading from the data fragments of the chunk
        // because this is most effective and does not require decoding
        await Promise.all(data_frags.map(frag => this.read_frag(frag, chunk)));
        try {
            await this.decode_chunk(chunk);
        } catch (err) {
            // verification mode will error if data fragments cannot be decoded
            if (this.verification_mode) throw err;
            if (data_frags.length === all_frags.length) throw err;
            dbg.warn('READ _read_part: failed to read data frags, trying all frags',
                err.stack || err,
                'err.chunks', util.inspect(err.chunks, true, null, true)
            );

            await Promise.all(all_frags.map(frag => this.read_frag(frag, chunk)));
            await this.decode_chunk(chunk);
        }

        // verification mode will also read the parity frags and decode it
        // by adding the minimum number of data fragments needed
        if (this.verification_mode) {
            const saved_data = chunk.data;
            chunk.data = undefined;
            for (const frag of data_frags) frag.data = undefined;
            const parity_frags = all_frags.filter(frag => frag.parity_index >= 0);
            const verify_frags = parity_frags.concat(data_frags.slice(0, data_frags.length - parity_frags.length));
            await Promise.all(verify_frags.map(frag => this.read_frag(frag, chunk)));
            await this.decode_chunk(chunk);
            assert(chunk.data.equals(saved_data));
        }
    }

    async decode_chunk(chunk) {
        await new Promise((resolve, reject) =>
            nb_native().chunk_coder('dec', chunk, err => (err ? reject(err) : resolve()))
        );
    }

    async encode_chunk(chunk) {
        await new Promise((resolve, reject) =>
            nb_native().chunk_coder('enc', chunk, err => (err ? reject(err) : resolve()))
        );
    }

    /**
     * @param {nb.Frag} frag 
     * @param {nb.Chunk} chunk
     * @returns {Promise<void>}
     */
    async read_frag(frag, chunk) {

        if (frag.data) return;
        if (!frag.blocks) return;

        // verification mode reads all the blocks instead of just one
        if (this.verification_mode) {
            const block_md0 = frag.blocks[0].to_block_md();
            try {
                const buffers = await P.map(frag.blocks, block => this.read_block(block));
                frag.data = buffers[0];
                for (let i = 1; i < buffers.length; ++i) {
                    const buffer = buffers[i];
                    if (block_md0.digest_type !== chunk.chunk_coder_config.frag_digest_type ||
                        block_md0.digest_b64 !== frag.digest_b64) {
                        throw new Error('READ _read_frag: (verification_mode) inconsistent replica digests');
                    }
                    assert(buffer.equals(frag.data), 'READ _read_frag: (verification_mode) inconsistent data');
                }
            } catch (err) {
                await this.report_error(block_md0, 'read', err);
            }
        } else {
            for (const block of frag.blocks) {
                try {
                    frag.data = await this.read_block(block);
                    return;
                } catch (err) {
                    await this.report_error(block.to_block_md(), 'read', err);
                }
            }
        }
    }

    /**
     * @param {nb.Block} block
     * @returns {Promise<Buffer>}
     */
    async read_block(block) {
        // use semaphore to surround the IO
        return block_read_sem_agent.surround_key(block.node_id.toHexString(), async () =>
            block_read_sem_global.surround(async () => {
                const block_md = block.to_block_md();
                dbg.log1('read_block:', block._id, 'from', block.address);

                this._error_injection_on_read();

                const res = await block_store_client.read_block(this.rpc_client, {
                    block_md,
                }, {
                    address: block.address,
                    timeout: config.IO_READ_BLOCK_TIMEOUT,
                    auth_token: null // ignore the client options when talking to agents
                });

                /** @type {Buffer} */
                const data = res[RPC_BUFFERS].data;

                // verification mode checks here the block digest.
                // this detects tampering which the agent did not report which means the agent is hacked.
                // we don't do this in normal mode because our native decoding checks it,
                // however the native code does not return a TAMPERING error that the system understands.
                // TODO GUY OPTIMIZE translate tampering errors from native decode (also for normal mode)
                if (this.verification_mode) {
                    const digest_b64 = crypto.createHash(block_md.digest_type).update(data).digest('base64');
                    if (digest_b64 !== block_md.digest_b64) {
                        throw new RpcError('TAMPERING', 'Block digest varification failed ' + block_md.id);
                    }
                }

                return data;
            }));
    }

    _error_injection_on_write() {
        if (config.ERROR_INJECTON_ON_WRITE &&
            config.ERROR_INJECTON_ON_WRITE > Math.random()) {
            throw new RpcError('ERROR_INJECTON_ON_WRITE');
        }
    }

    _error_injection_on_read() {
        if (config.ERROR_INJECTON_ON_READ &&
            config.ERROR_INJECTON_ON_READ > Math.random()) {
            throw new RpcError('ERROR_INJECTON_ON_READ');
        }
    }

}

exports.MapClient = MapClient;
