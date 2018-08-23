/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);

// dbg.set_level(5, 'core');

class MapClient {

    constructor({
        chunks,
        parts,
        rpc_client,
        location_info,
        move_to_tier,
    }) {
        this.chunks = chunks;
        this.parts = parts;
        this.rpc_client = rpc_client;
        this.location_info = location_info;
        this.move_to_tier = move_to_tier;
    }

    async run() {
        await this.get_mappings();
        await this.process_mappings();
        await this.put_mappings();
    }

    // object_server.put_mappings will handle:
    // - allocations
    // - make_room_in_tier
    async get_mappings() {
        this.chunks_mappings = await this.rpc_client.object.get_mappings({
            chunks: this.chunks.map(get_chunk_info),
            location_info: this.location_info,
            move_to_tier: this.move_to_tier,
        });
        for (let i = 0; i < this.chunks.length; ++i) {
            set_blocks_to_maps(this.chunks[i], this.chunks_mappings[i]);
        }
    }

    // object_server.put_mappings will handle:
    // - deletions
    // - update_db
    async put_mappings() {
        await this.rpc_client.object.put_mappings({
            chunks: this.chunks_mappings,
            parts: this.parts,
        });
    }

    async process_mappings() {
        await P.map(this.chunks_mappings, async chunk => this.process_chunk(chunk));
    }

    async process_chunk(chunk) {
        // chunk[util.inspect.custom] = custom_inspect_chunk;

        dbg.log0('MapBuilder.build_chunks: allocations needed for chunk',
            chunk, _.map(chunk.objects, 'key'));

        if (chunk.missing_frags) {
            await this.read_entire_chunk(chunk);
        }

        const call_process_frag = frag => this.process_frag(chunk, frag);
        const start_time = Date.now();
        let done = false;
        while (!done) {
            try {
                await P.map(chunk.frags, call_process_frag);
                done = true;
            } catch (err) {
                if (Date.now() - start_time > config.IO_WRITE_PART_ATTEMPTS_EXHAUSTED) {
                    dbg.error('UPLOAD:', part.desc, 'write part attempts exhausted', err);
                    throw err;
                }
                dbg.warn('UPLOAD:', part.desc, 'write part reallocate on ERROR', err);
                const res = await this.rpc_client.object.get_mappings({
                    chunks: [get_chunk_info(chunk)],
                    location_info: this.location_info,
                    move_to_tier: this.move_to_tier,
                });
                chunk = res[0];
            }
        }
    }

    async process_frag(chunk, frag) {
        if (!frag.allocations) return;
        if (frag.accessible_blocks) {
            let next_source = 'TODO: random index in frag.accessible_blocks';
            await P.map(frag.allocations, async alloc => {
                const source_block = frag.accessible_blocks[next_source];
                next_source = (next_source + 1) % frag.accessible_blocks.length;
                return this.replicate_block(chunk, frag, alloc, source_block);
            });
        } else if (frag.block) {
            const first_alloc = frag.allocations[0];
            const rest_allocs = frag.allocations.slice(1);
            await this.write_block(chunk, frag, first_alloc, frag.block);
            await P.map(rest_allocs, alloc => this.replicate_block(chunk, frag, alloc, first_alloc.block));
        } else {
            throw new Error('No data source to write new block');
        }
    }

    async read_entire_chunk(chunk) {
        const part_candidate = _.clone(chunk.parts[0]);
        part_candidate.chunk = chunk;
        const part = mapper.get_part_info(part_candidate);
        part.desc = { chunk: chunk._id };
        const chunk_info = part.chunk;
        const params = {
            client: chunk.rpc_client,
            bucket: chunk.bucket.name,
            key: '', // faking it as we don't want to read and obj just for that
        };

        dbg.log0('MapBuilder.read_entire_chunk: chunk before reading', chunk_info);
        try {
            await object_io._read_frags(params, part, chunk_info.frags);
        } catch (err) {
            dbg.warn('MapBuilder.read_entire_chunk: _read_frags ERROR',
                err.stack || err,
                util.inspect(err.chunks, true, null, true)
            );
            throw err;
        }

        dbg.log0('MapBuilder.read_entire_chunk: chunk before encoding', chunk_info);
        chunk_info.coder = 'enc';
        await P.fromCallback(cb => nb_native().chunk_coder(chunk_info, cb));

        dbg.log0('MapBuilder.read_entire_chunk: final chunk', chunk_info);
        set_blocks_to_maps(chunk, chunk_info);
    }

}

function get_chunk_info(chunk) {
    const c = _.pick(chunk, CHUNK_ATTRS);
    c.frags = _.map(c.frags, frag => _.pick(frag, FRAG_ATTRS));
    return c;
}

function set_blocks_to_maps(chunk, chunk_mapping) {
    for (const frag of chunk.frags) {
        const frag_with_data = _.find(chunk_mapping.frags, _.matches(_.pick(frag, 'data_index', 'parity_index', 'lrc_index')));
        frag.block = frag_with_data.block;
    }
}

module.exports = MapClient;
