/**
 *
 * BLOCK STORE MEM
 *
 * memory only alternative, for testing
 *
 */
'use strict';

const _ = require('lodash');

const BlockStoreBase = require('./block_store_base').BlockStoreBase;


class BlockStoreMem extends BlockStoreBase {

    constructor(options) {
        super(options);
        this._used = 0;
        this._count = 0;
        this._blocks = {};
    }

    get_storage_info() {
        const total = 1024 * 1024 * 1024;
        //from some reason we don't init this value. I can't find it now.
        //TODO: init correctly.
        if (!this._used)
        {
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
        const b = this._blocks[block_id];
        if (!b) {
            throw new Error('No such block ' + block_id);
        }
        return b;
    }

    _write_block(block_md, data) {
        const block_id = block_md.id;
        const b = this._blocks[block_id];
        if (b) {
            this._used -= b.length;
            this._count -= 1;
        }
        this._blocks[block_id] = {
            data: data,
            block_md: block_md
        };
        this._used += data.length;
        this._count += 1;
    }

    _delete_blocks(block_ids) {
        _.each(block_ids, block_id => {
            const b = this._blocks[block_id];
            if (b) {
                this._used -= b.length;
                this._count -= 1;
            }
            delete this._blocks[block_id];
        });
    }

}

// EXPORTS
exports.BlockStoreMem = BlockStoreMem;
