/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const BlockStoreBase = require('./block_store_base').BlockStoreBase;


class BlockStoreMem extends BlockStoreBase {

    constructor(options) {
        super(options);
        this._usage = {
            size: 0,
            count: 0
        };
        this._blocks = new Map();
        // below 15 GB the node is deactivated, so we report 16 GB here
        this.usage_limit = 16 * 1024 * 1024 * 1024;
    }

    init() {
        dbg.log0('BlockStoreMem.init: nothing to do for memory store');
    }

    get_storage_info() {
        return {
            total: this.usage_limit,
            free: this.usage_limit - this._usage.size,
            used: this._usage.size,
        };
    }

    _write_usage_internal() {
        // noop
    }

    _get_usage() {
        return this._usage;
    }

    _read_block(block_md) {
        const block_id = block_md.id;
        const b = this._blocks.get(block_id);
        if (!b) {
            throw new Error('No such block ' + block_id);
        }
        return b;
    }

    _write_block(block_md, data) {
        const block_id = block_md.id;
        const b = this._blocks.get(block_id);
        const usage = { size: 0, count: 0 };
        if (b) {
            usage.size -= b.data.length;
            usage.count -= 1;
        }
        this._blocks.set(block_id, { data, block_md });
        usage.size += block_md.is_preallocated ? 0 : data.length;
        usage.count += block_md.is_preallocated ? 0 : 1;
        this._update_usage(usage);
    }

    _delete_blocks(block_ids) {
        const usage = { size: 0, count: 0 };
        _.each(block_ids, block_id => {
            const b = this._blocks.get(block_id);
            if (b) {
                usage.size -= b.data.length;
                usage.count -= 1;
                this._blocks.delete(block_id);
            }
        });
        this._update_usage(usage);
        // Just a place filler since we always succeed in deletions
        return {
            failed_block_ids: [],
            succeeded_block_ids: _.difference(block_ids, [])
        };
    }
}

// EXPORTS
exports.BlockStoreMem = BlockStoreMem;
