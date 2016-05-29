'use strict';

const _ = require('lodash');
const crypto = require('crypto');

// const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const js_utils = require('../util/js_utils');
const LRUCache = require('../util/lru_cache');
const RpcError = require('../rpc/rpc_error');

class BlockStoreBase {

    constructor(options) {
        this.node_name = options.node_name;
        this.client = options.rpc_client;
        this.storage_limit = options.storage_limit;
        this.block_cache = new LRUCache({
            name: 'BlockStoreCache',
            max_usage: 200 * 1024 * 1024, // 200 MB
            item_usage: block => block.data.length,
            expiry_ms: 0, // no expiry
            make_key: block_md => block_md.id,
            load: block_md => {
                return this._read_block(block_md)
                    .then(block => {
                        this._verify_block(block_md, block.data, block.block_md);
                        return block;
                    });
            }
        });

        // BLOCK STORE API methods - bind to self
        // (rpc registration requires bound functions)
        js_utils.self_bind(this, [
            'write_block',
            'read_block',
            'replicate_block',
            'delete_blocks',
        ]);
    }

    read_block(req) {
        const block_md = req.rpc_params.block_md;
        dbg.log1('read_block', block_md.id, 'node', this.node_name);
        return this.block_cache.get_with_cache(block_md)
            .then(block => {
                // must clone before returning to rpc encoding
                // since it mutates the object for encoding buffers
                return _.clone(block);
            });
    }

    write_block(req) {
        const block_md = req.rpc_params.block_md;
        const data = req.rpc_params.data;
        dbg.log1('write_block', block_md.id, data.length, 'node', this.node_name);
        if (this.storage_limit) {
            const free_space = this.storage_limit - this._usage.size;
            const required_space = data.length + (1024 * 1024); // require some spare space
            if (free_space < required_space) {
                throw new Error('used space exceeded the storage limit of ' +
                    this._storage_limit + ' bytes');
            }
        }
        this._verify_block(block_md, data);
        this.block_cache.invalidate(block_md);
        return this._write_block(block_md, data)
            .then(() => {
                this.block_cache.put_in_cache(block_md, {
                    block_md: block_md,
                    data: data
                });
            });
    }

    replicate_block(req) {
        const target_md = req.rpc_params.target;
        const source_md = req.rpc_params.source;
        dbg.log1('replicate_block', target_md.id, 'node', this.node_name);

        // read from source agent
        return this.client.block_store.read_block({
                block_md: source_md
            }, {
                address: source_md.address,
            })
            .then(res => this._write_block(target_md, res.data))
            .return();
    }

    delete_blocks(req) {
        const block_ids = req.rpc_params.block_ids;
        dbg.log0('delete_blocks', block_ids, 'node', this.node_name);
        this.block_cache.multi_invalidate_keys(block_ids);
        return this._delete_blocks(block_ids).return();
    }

    _verify_block(block_md, data, block_md_from_store) {

        if (!Buffer.isBuffer(data)) {
            throw new Error('Block data must be a buffer');
        }

        // verify block md from store match
        if (block_md_from_store) {
            if (block_md_from_store.id !== block_md.id ||
                block_md_from_store.digest_type !== block_md.digest_type ||
                block_md_from_store.digest_b64 !== block_md.digest_b64) {
                throw new RpcError('TAMPERING', 'Block md mismatch ' + block_md.id);
            }
        }

        // verify data digest
        if (block_md.digest_type) {
            const digest_b64 = crypto.createHash(block_md.digest_type)
                .update(data)
                .digest('base64');
            if (digest_b64 !== block_md.digest_b64) {
                throw new RpcError('TAMPERING', 'Block digest mismatch ' + block_md.id);
            }
        }
    }



}

// EXPORTS
exports.BlockStoreBase = BlockStoreBase;
