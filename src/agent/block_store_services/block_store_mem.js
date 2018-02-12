/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const BlockStoreBase = require('./block_store_base').BlockStoreBase;


class BlockStoreMem extends BlockStoreBase {

    constructor(options) {
        super(options);
        this._used = 0;
        this._count = 0;
        this._blocks = new Map();
    }

    init() {
        dbg.log0('BlockStoreMem.init: nothing to do for memory store');
    }

    get_storage_info() {
        // below 15 GB the node is deactivated, so we report 16 GB here
        const total = 16 * 1024 * 1024 * 1024;
        //from some reason we don't init this value. I can't find it now.
        //TODO: init correctly.
        if (!this._used) {
            this._used = 0;
        }
        return {
            total: total,
            free: total - this._used,
            used: this._used,
        };
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
        if (b) {
            this._used -= b.length;
            this._count -= 1;
        }
        this._blocks.set(block_id, {
            data: data,
            block_md: block_md
        });
        this._used += data.length;
        this._count += 1;
    }

    _delete_blocks(block_ids) {
        _.each(block_ids, block_id => {
            const b = this._blocks.get(block_id);
            if (b) {
                this._used -= b.length;
                this._count -= 1;
                this._blocks.delete(block_id);
            }
        });
        // Just a place filler since we always succeed in deletions
        return {
            failed_block_ids: [],
            succeeded_block_ids: _.difference(block_ids, [])
        };
    }
}

// EXPORTS
exports.BlockStoreMem = BlockStoreMem;
