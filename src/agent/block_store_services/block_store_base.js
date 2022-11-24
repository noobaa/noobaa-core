/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const crypto = require('crypto');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const js_utils = require('../../util/js_utils');
const LRUCache = require('../../util/lru_cache');
const KeysLock = require('../../util/keys_lock');
const time_utils = require('../../util/time_utils');
const { RpcError, RPC_BUFFERS } = require('../../rpc');
const hex_str_regex = /^[0-9a-fA-F]+$/;

function _new_monitring_stats() {
    return {
        inflight_reads: 0,
        max_inflight_reads: 0,
        inflight_writes: 0,
        max_inflight_writes: 0,
        read_count: 0,
        total_read_latency: 0,
        write_count: 0,
        total_write_latency: 0
    };
}

function get_block_internal_dir(block_id) {
    let internal_dir = hex_str_regex.test(block_id) ?
        block_id.substring(block_id.length - 3) + '.blocks' :
        'other.blocks';
    return internal_dir;
}

class BlockStoreBase {

    constructor(options) {
        this.node_name = options.node_name;
        this.client = options.rpc_client;
        this.storage_limit = options.storage_limit;
        this.usage_limit = options.storage_limit || Infinity;
        // semaphore to serialize writes\deletes of specific blocks
        this.block_modify_lock = new KeysLock();
        this.block_cache = new LRUCache({
            name: 'BlockStoreCache',
            max_usage: 100 * 1024 * 1024, // 100 MB
            item_usage: block => block.data.length,
            make_key: block_md => block_md.id,
            load: async block_md => this._read_block_and_verify(block_md),
        });

        this.monitoring_stats = _new_monitring_stats();

        this.io_stats = this._new_io_stats();

        // BLOCK STORE API methods - bind to self
        // (rpc registration requires bound functions)
        js_utils.self_bind(this, [
            'write_block',
            'read_block',
            'delegate_write_block',
            'delegate_read_block',
            'replicate_block',
            'delete_blocks',
            'handle_delegator_error',
            'verify_blocks',
            'get_block_store_info',
            'update_store_usage',
        ]);
    }

    _new_io_stats() {
        return {
            read_count: 0,
            write_count: 0,
            read_bytes: 0,
            write_bytes: 0,
            error_write_bytes: 0,
            error_write_count: 0,
            error_read_bytes: 0,
            error_read_count: 0,
        };
    }

    get_block_store_info(req) {
        return this._get_block_store_info();
    }

    update_store_usage(req) {
        const io_stats = req.rpc_params;
        if (io_stats.read_count) {
            this.io_stats.read_count += io_stats.read_count;
            this.io_stats.read_bytes += io_stats.read_bytes;
        }
        if (io_stats.write_count) {
            this.io_stats.write_count += io_stats.write_count;
            this.io_stats.write_bytes += io_stats.write_bytes;
            this._update_usage({
                size: io_stats.write_bytes,
                count: io_stats.write_count
            });
        }
    }

    update_storage_limit(storage_limit) {
        this.storage_limit = storage_limit;
        this.usage_limit = this.storage_limit || Infinity;
    }

    _get_block_store_info() {
        throw new Error('this block store does not support block_store_info');
    }





    _update_read_stats(size, is_err) {
        if (is_err) {
            this.io_stats.read_count -= 1;
            this.io_stats.read_bytes -= size;
            this.io_stats.error_read_count += 1;
            this.io_stats.error_read_bytes += size;
        } else {
            this.io_stats.read_count += 1;
            this.io_stats.read_bytes += size;
        }
    }

    _update_write_stats(size, is_err) {
        if (is_err) {
            this.io_stats.write_count -= 1;
            this.io_stats.write_bytes -= size;
            this.io_stats.error_write_count += 1;
            this.io_stats.error_write_bytes += size;
        } else {
            this.io_stats.write_count += 1;
            this.io_stats.write_bytes += size;
        }
    }

    async read_block(req) {
        const block_md = req.rpc_params.block_md;
        dbg.log1('read_block', block_md.id, 'node', this.node_name);
        // must clone before returning to rpc encoding
        // since it mutates the object for encoding buffers
        this.monitoring_stats.inflight_reads += 1;
        this.monitoring_stats.max_inflight_reads = Math.max(this.monitoring_stats.inflight_reads, this.monitoring_stats.max_inflight_reads);
        try {
            const start = time_utils.millistamp();
            const block = await this.block_cache.get_with_cache(block_md);
            this.monitoring_stats.read_count += 1;
            this.monitoring_stats.total_read_latency += time_utils.millistamp() - start;
            return {
                block_md,
                [RPC_BUFFERS]: { data: block.data }
            };
        } finally {
            this.monitoring_stats.inflight_reads -= 1;
        }
    }

    /**
     * @param {nb.BlockMD} block_md
     */
    async _read_block_and_verify(block_md) {
        const block = await this._read_block(block_md);
        this._update_read_stats(block.data.length);
        this._verify_block(block_md, block.data, block.block_md);
        return block;
    }

    async verify_blocks(req) {
        const { verify_blocks } = req.rpc_params;
        await P.map_with_concurrency(10, verify_blocks, block_md => this.verify_block(block_md));
    }

    /**
     * @param {nb.BlockMD} block_md
     */
    async verify_block(block_md) {
        try {
            const [block_from_store, block_from_cache] = await Promise.all([
                this._read_block_md(block_md),
                this.block_cache.peek_cache(block_md)
            ]);
            if (block_from_store) {
                this._verify_block(block_md, block_from_store.data, block_from_store.block_md);
            } else {
                // TODO: Should trigger further action in order to resolve the issue
                dbg.error('verify_blocks BLOCK NOT EXISTS',
                    ' on block:', block_md);
                return;
            }

            if (block_from_cache) {
                this._verify_block(block_md, block_from_cache.data, block_from_cache.block_md);
            }
        } catch (err) {
            // TODO: Should trigger further action in order to resolve the issue
            dbg.error('verify_blocks HAD ERROR on block:', block_md, err);
        }
    }

    /**
     * @param {nb.BlockMD} block_md
     */
    async _read_block_md(block_md) {
        const block = this._read_block(block_md);
        if (block.data) this._update_read_stats(block.data.length);
        return block;
    }

    _check_write_space(data_length) {
        const required_space = data_length + (1024 * 1024); // require some spare space
        if (this.usage_limit - this._usage.size < required_space) {
            throw new RpcError('NO_BLOCK_STORE_SPACE', 'used space exceeded the total capacity of ' +
                this.usage_limit + ' bytes');
        }
    }

    async write_block(req) {
        const block_md = req.rpc_params.block_md;
        const data = req.rpc_params[RPC_BUFFERS].data || Buffer.alloc(0);
        await this.write_block_internal(block_md, data);
    }

    /**
     * @param {nb.BlockMD} block_md
     * @param {Buffer} data 
     */
    async write_block_internal(block_md, data) {
        dbg.log1('write_block', block_md.id, data.length, block_md.digest_b64, 'node', this.node_name);
        if (!block_md.is_preallocated) { // no need to verify space
            this._check_write_space(data.length);
        }
        this._verify_block(block_md, data);
        this.block_cache.invalidate(block_md);
        this.monitoring_stats.inflight_writes += 1;
        this.monitoring_stats.max_inflight_writes = Math.max(
            this.monitoring_stats.inflight_writes,
            this.monitoring_stats.max_inflight_writes
        );
        try {
            const start = time_utils.millistamp();
            await this.block_modify_lock.surround_keys([String(block_md.id)], async () => {
                await this._write_block(block_md, data);
                this.block_cache.put_in_cache(block_md, { block_md, data });
            });
            this.monitoring_stats.write_count += 1;
            this._update_write_stats(data.length);
            this.monitoring_stats.total_write_latency += time_utils.millistamp() - start;
        } finally {
            this.monitoring_stats.inflight_writes -= 1;
        }
    }

    async preallocate_block(req) {
        const block_md = req.rpc_params.block_md;
        dbg.log0('preallocate_block', block_md.id, block_md.size, block_md.digest_b64, 'node', this.node_name);
        this._check_write_space(block_md.size);
        const block_size = block_md.size;
        let usage = {
            size: block_size,
            count: 1
        };
        return this._update_usage(usage);
    }

    sample_stats() {
        const old_stats = this.monitoring_stats;
        // zero all but the inflight
        this.monitoring_stats = _.defaults(_.pick(old_stats, ['inflight_reads', 'inflight_writes']), _new_monitring_stats());
        old_stats.avg_read_latency = old_stats.total_read_latency / old_stats.read_count;
        old_stats.avg_write_latency = old_stats.total_write_latency / old_stats.write_count;
        return old_stats;
    }

    get_and_reset_io_stats() {
        const old_stats = this.io_stats;
        this.io_stats = this._new_io_stats();
        return old_stats;
    }

    async replicate_block(req) {
        const target_md = req.rpc_params.target;
        const source_md = req.rpc_params.source;
        dbg.log1('replicate_block', target_md.id, 'node', this.node_name);

        // read from source agent
        const res = await this.client.block_store.read_block({
            block_md: source_md
        }, {
            address: source_md.address,
        });
        await this.write_block_internal(target_md, res[RPC_BUFFERS].data);
    }

    async delete_blocks(req) {
        const block_ids = req.rpc_params.block_ids;
        dbg.log1('delete_blocks', block_ids, 'node', this.node_name);
        this.block_cache.multi_invalidate_keys(block_ids);
        return this.block_modify_lock.surround_keys(
            block_ids.map(block_id => String(block_id)),
            async () => this._delete_blocks(block_ids)
        );
    }

    /**
     * @param {nb.BlockMD} block_md
     * @param {Buffer} data
     * @param {nb.BlockMD} block_md_from_store
     */
    _verify_block(block_md, data, block_md_from_store) {
        // verify block md from store match
        if (block_md_from_store) {
            if (block_md_from_store.id !== block_md.id ||
                block_md_from_store.digest_type !== block_md.digest_type ||
                block_md_from_store.digest_b64 !== block_md.digest_b64) {
                throw new RpcError('TAMPERING', 'Block md mismatch ' + block_md.id);
            }
        }

        if (!_.isUndefined(data)) {
            if (!Buffer.isBuffer(data)) {
                throw new Error('Block data must be a buffer');
            }

            // verify data digest
            if (block_md.digest_type) {
                const digest_b64 = crypto.createHash(block_md.digest_type).update(data).digest('base64');
                if (digest_b64 !== block_md.digest_b64) {
                    throw new RpcError('TAMPERING', 'Block digest mismatch ' + block_md.id);
                }
            }
        }
    }

    async cleanup_target_path() { _.noop(); }

    _handle_delegator_error() {
        throw new Error('this block store does not delegate');
    }

    handle_delegator_error(req) {
        return this._handle_delegator_error(req.rpc_params.error, req.rpc_params.usage, req.rpc_params.op_type);
    }

    _update_usage(usage) {
        if (!this._usage) return;
        this._usage.size += usage.size;
        this._usage.count += usage.count;

        // mark that writing the usage is needed, so that even if we are in the middle of writing
        // we will not forget this last update
        this.update_usage_needed = true;
        if (!this.update_usage_work_item) {
            this.update_usage_work_item = setTimeout(() => this._write_usage(), 3000);
        }
    }

    async _write_usage() {
        // reset the needed value at the time we took the usage value
        // which will allow to know if new updates are added while we write
        this.update_usage_needed = false;

        try {
            await this._write_usage_internal();
        } catch (err) {
            console.error('write_usage ERROR', err);
            this.update_usage_needed = true;
        } finally {
            if (this.update_usage_needed) {
                // trigger a new update
                this.update_usage_work_item = setTimeout(() => this._write_usage(), 3000);
            } else {
                // write is successful, allow new writes
                this.update_usage_work_item = null;
            }
        }
    }

    async test_store_perf({ count }) {
        try {
            const reply = {};
            const delay_ms = 200;
            const data = crypto.randomBytes(1024);
            const digest_type = config.CHUNK_CODER_FRAG_DIGEST_TYPE || 'sha1';
            const block_md = {
                id: '_test_store_perf',
                digest_type,
                digest_b64: crypto.createHash(digest_type).update(data).digest('base64')
            };
            reply.write = await test_average_latency(count, delay_ms, async () => {
                await this._write_block(block_md, data, { ignore_usage: true });
                this._update_write_stats(data.length);
            });
            reply.read = await test_average_latency(count, delay_ms, async () => {
                const block = await this._read_block(block_md);
                if (block.data) this._update_read_stats(block.data.length);
                this._verify_block(block_md, block.data, block.block_md);
                if (!data.equals(block.data)) throw new Error('test_store_perf: unexpected data on read');
            });
            // cleanup old versions for block stores that have versioning enabled
            if (this._delete_block_past_versions) await this._delete_block_past_versions(block_md);
            return reply;
        } catch (err) {
            if (err.rpc_code !== 'AUTH_FAILED' && err.rpc_code !== 'STORAGE_NOT_EXIST') {
                dbg.warn(`encountered unknown error in test_store_perf`, err);
            }
            throw err;
        }
    }

    async test_store_validity() {
        // default behavior for test store validity is test_store_perf({count:1})
        await this.test_store_perf({ count: 1 });
    }

    /**
     * @param {nb.BlockMD} block_md
     */
    _encode_block_md(block_md) {
        return Buffer.from(JSON.stringify(block_md)).toString('base64');
    }

    /**
     * @param {string} noobaablockmd
     */
    _decode_block_md(noobaablockmd) {
        return JSON.parse(Buffer.from(noobaablockmd, 'base64'));
    }

    _block_key(block_id) {
        const block_dir = get_block_internal_dir(block_id);
        return `${this.blocks_path}/${block_dir}/${block_id}`;
    }

    _block_id_from_key(block_key) {
        return block_key.split('/').pop();
    }

}

async function test_average_latency(count, delay_ms, async_func) {
    // throw the first result which is sometimes skewed
    await async_func();
    await P.delay(delay_ms);
    const results = [];
    for (let i = 0; i < count; ++i) {
        const start = time_utils.millistamp();
        await async_func();
        const took = time_utils.millistamp() - start;
        results.push(took);
        // use some jitter delay to avoid serializing on cpu when
        // multiple tests are run together.
        const jitter = 0.5 + Math.random(); // 0.5 - 1.5
        await P.delay(delay_ms * jitter);
    }
    return results;
}

// EXPORTS
exports.BlockStoreBase = BlockStoreBase;
exports.get_block_internal_dir = get_block_internal_dir;
