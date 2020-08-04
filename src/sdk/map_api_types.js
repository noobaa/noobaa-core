/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('./nb')} nb */
/** @typedef {import('../server/system_services/system_store').SystemStore} SystemStore */

const _ = require('lodash');
const util = require('util');

const db_client = require('../util/db_client');

/** @type {nb.ID} */
const undefined_id = undefined;

/**
 *
 * @param {string} [id_str]
 * @returns {nb.ID | undefined}
 */
function parse_optional_id(id_str) {
    return id_str === undefined ? undefined : db_client.instance().parse_object_id(id_str);
}

/**
 * @implements {nb.Chunk}
 */
class ChunkAPI {

    /**
     * @param {ChunkAPI} chunk
     * @returns {nb.Chunk}
     */
    static implements_interface(chunk) { return chunk; }

    /**
     * @param {nb.ChunkInfo} chunk_info
     * @param {SystemStore} [system_store]
     */
    constructor(chunk_info, system_store) {
        this.chunk_info = chunk_info;
        this.system_store = system_store;
        this.had_errors = false;
        ChunkAPI.implements_interface(this);
    }

    get _id() { return parse_optional_id(this.chunk_info._id); }
    get bucket_id() { return parse_optional_id(this.chunk_info.bucket_id); }
    get tier_id() { return parse_optional_id(this.chunk_info.tier_id); }
    get size() { return this.chunk_info.size; }
    get compress_size() { return this.chunk_info.compress_size; }
    get frag_size() { return this.chunk_info.frag_size; }
    get digest_b64() { return this.chunk_info.digest_b64; }
    get cipher_key_b64() { return this.chunk_info.cipher_key_b64; }
    get master_key_id() { return this.chunk_info.master_key_id; }
    get cipher_iv_b64() { return this.chunk_info.cipher_iv_b64; }
    get cipher_auth_tag_b64() { return this.chunk_info.cipher_auth_tag_b64; }
    get chunk_coder_config() { return this.chunk_info.chunk_coder_config; }

    get data() { return this.chunk_info.data; }
    set data(buf) { this.chunk_info.data = buf; }

    /** @returns {nb.Bucket} */
    get bucket() { return this.system_store.data.get_by_id(this.chunk_info.bucket_id); }
    /** @returns {nb.Tier} */
    get tier() { return this.system_store.data.get_by_id(this.chunk_info.tier_id); }
    /** @returns {nb.ChunkConfig} */
    get chunk_config() {
        return _.find(this.bucket.system.chunk_configs_by_id,
            c => _.isEqual(c.chunk_coder_config, this.chunk_coder_config));
    }

    get is_accessible() { return this.chunk_info.is_accessible; }
    set is_accessible(val) { this.chunk_info.is_accessible = val; }
    get is_building_blocks() { return this.chunk_info.is_building_blocks; }
    set is_building_blocks(val) { this.chunk_info.is_building_blocks = val; }
    get is_building_frags() { return this.chunk_info.is_building_frags; }
    set is_building_frags(val) { this.chunk_info.is_building_frags = val; }
    get dup_chunk_id() { return parse_optional_id(this.chunk_info.dup_chunk); }
    set dup_chunk_id(val) { this.chunk_info.dup_chunk = val.toHexString(); }

    get frags() {
        if (!this.__frags) {
            this.__frags = this.chunk_info.frags.map(
                frag_info => new_frag_api(frag_info, this.system_store)
            );
        }
        return this.__frags;
    }
    get frag_by_index() {
        if (!this.__frag_by_index) this.__frag_by_index = _.keyBy(this.frags, 'frag_index');
        return this.__frag_by_index;
    }
    get parts() {
        if (!this.__parts) {
            this.__parts = this.chunk_info.parts.map(
                part_info => new_part_api(part_info, this.bucket_id, this.system_store)
            );
        }
        return this.__parts;
    }

    set_new_chunk_id() {
        if (this._id) throw new Error(`ChunkAPI.set_new_chunk_id: unexpected call for existing chunk ${this._id}`);
        this.chunk_info._id = db_client.instance().new_object_id().toHexString();
    }

    /**
     * @param {nb.Frag} frag
     * @param {nb.Pool[]} pools
     * @param {nb.TierMirror} mirror
     */
    add_block_allocation(frag, pools, mirror) {
        const block_md = {
            id: db_client.instance().new_object_id().toHexString(),
            size: this.frag_size,
            digest_b64: frag.digest_b64,
            digest_type: this.chunk_coder_config.frag_digest_type,
        };
        if (!frag.allocations) frag.allocations = [];
        frag.allocations.push({
            mirror_group: mirror._id.toHexString(),
            block_md,
            mirror,
            pools,
        });
        frag.is_building_blocks = true;
        this.is_building_blocks = true;
    }

    /**
     * @returns {nb.ChunkInfo}
     */
    to_api() {
        return {
            _id: this.chunk_info._id,
            master_key_id: this.chunk_info.master_key_id,
            bucket_id: this.chunk_info.bucket_id,
            tier_id: this.chunk_info.tier_id,
            chunk_coder_config: this.chunk_info.chunk_coder_config,
            size: this.chunk_info.size,
            frag_size: this.chunk_info.frag_size,
            compress_size: this.chunk_info.compress_size,
            digest_b64: this.chunk_info.digest_b64,
            cipher_key_b64: this.chunk_info.cipher_key_b64,
            cipher_iv_b64: this.chunk_info.cipher_iv_b64,
            cipher_auth_tag_b64: this.chunk_info.cipher_auth_tag_b64,
            dup_chunk: this.chunk_info.dup_chunk,
            is_accessible: this.chunk_info.is_accessible,
            is_building_blocks: this.chunk_info.is_building_blocks,
            is_building_frags: this.chunk_info.is_building_frags,
            frags: this.frags.map(frag => frag.to_api()),
            parts: this.parts.map(part => part.to_api()),
        };
    }

    /**
     * @returns {nb.ChunkSchemaDB}
     */
    to_db() {
        return {
            _id: this._id,
            master_key_id: this.master_key_id,
            bucket: this.bucket_id,
            tier: this.tier_id,
            size: this.size,
            compress_size: this.compress_size,
            frag_size: this.frag_size,
            dedup_key: from_b64(this.chunk_info.digest_b64),
            digest: from_b64(this.chunk_info.digest_b64),
            cipher_key: this._encrypt_cipher_key(this.chunk_info.cipher_key_b64, this.chunk_info.master_key_id),
            cipher_iv: from_b64(this.chunk_info.cipher_iv_b64),
            cipher_auth_tag: from_b64(this.chunk_info.cipher_auth_tag_b64),
            chunk_config: this.chunk_config._id,
            system: this.bucket.system._id,
            tier_lru: new Date(),
            frags: this.frags.map(frag => frag.to_db()),
        };
    }

    _encrypt_cipher_key(cipher_key, master_key_id) {
        if (!master_key_id) return from_b64(cipher_key);
        return this.system_store.master_key_manager.encrypt_buffer_with_master_key_id(from_b64(cipher_key), master_key_id);
    }
}

/**
 * @implements {nb.Frag}
 */
class FragAPI {

    /**
     * @param {FragAPI} frag
     * @returns {nb.Frag}
     */
    static implements_interface(frag) { return frag; }

    /**
     * @param {nb.FragInfo} frag_info
     * @param {SystemStore} [system_store]
     */
    constructor(frag_info, system_store) {
        this.frag_info = frag_info;
        this.system_store = system_store;
        this.is_accessible = false;
        this.is_building_blocks = false;
        FragAPI.implements_interface(this);
    }

    get _id() { return parse_optional_id(this.frag_info._id); }
    get data_index() { return this.frag_info.data_index; }
    get parity_index() { return this.frag_info.parity_index; }
    get lrc_index() { return this.frag_info.lrc_index; }
    get digest_b64() { return this.frag_info.digest_b64; }

    set data(buf) { this.frag_info.data = buf; }
    get data() { return this.frag_info.data; }

    get frag_index() {
        if (this.frag_info.data_index >= 0) return `D${this.frag_info.data_index}`;
        if (this.frag_info.parity_index >= 0) return `P${this.frag_info.parity_index}`;
        if (this.frag_info.lrc_index >= 0) return `L${this.frag_info.lrc_index}`;
        throw new Error('BAD FRAG ' + util.inspect(this));
    }

    get blocks() {
        if (!this.__blocks) {
            this.__blocks = this.frag_info.blocks.map(
                block_info => new_block_api(block_info, this.system_store)
            );
        }
        return this.__blocks;
    }

    get allocations() { return this.frag_info.allocations; }
    set allocations(val) { this.frag_info.allocations = val; }

    set_new_frag_id() {
        this.frag_info._id = db_client.instance().new_object_id().toHexString();
    }

    /**
     * @returns {nb.FragInfo}
     */
    to_api() {
        return {
            _id: this.frag_info._id,
            data_index: this.frag_info.data_index,
            parity_index: this.frag_info.parity_index,
            lrc_index: this.frag_info.lrc_index,
            digest_b64: this.frag_info.digest_b64,
            blocks: this.blocks.map(block => block.to_api()),
            allocations: this.allocations && this.allocations.map(({ mirror_group, block_md }) => ({ mirror_group, block_md })),
        };
    }

    /**
     * @returns {nb.FragSchemaDB}
     */
    to_db() {
        return {
            _id: this._id,
            data_index: this.data_index,
            parity_index: this.parity_index,
            lrc_index: this.lrc_index,
            digest: from_b64(this.frag_info.digest_b64),
        };
    }
}

/**
 * @implements {nb.Block}
 */
class BlockAPI {

    /**
     * @param {BlockAPI} block
     * @returns {nb.Block}
     */
    static implements_interface(block) { return block; }

    /**
     * @param {nb.BlockInfo} block_info
     * @param {SystemStore} [system_store]
     */
    constructor(block_info, system_store) {
        this.block_info = block_info;
        this.block_md = block_info.block_md;
        /** @type {nb.NodeAPI} */
        this.node = undefined;
        this.system_store = system_store;
        this.chunk_id = undefined_id;
        this.frag_id = undefined_id;
        this.bucket_id = undefined_id;
        BlockAPI.implements_interface(this);
    }

    get _id() { return db_client.instance().parse_object_id(this.block_md.id); }
    get node_id() { return parse_optional_id(this.block_md.node); }
    get pool_id() { return parse_optional_id(this.block_md.pool); }
    get size() { return this.block_md.size; }
    get address() { return this.block_md.address; }

    /** @returns {nb.Pool} */
    get pool() { return this.system_store.data.get_by_id(this.pool_id); }
    /** @returns {nb.Bucket} */
    get bucket() { return this.system_store.data.get_by_id(this.bucket_id); }
    /** @returns {nb.System} */
    get system() { return this.pool.system; }

    // get frag() { return undefined_frag; }
    // get chunk() { return undefined_chunk; }

    get is_preallocated() { return Boolean(this.block_md.is_preallocated); }
    set is_preallocated(val) { this.block_md.is_preallocated = Boolean(val); }
    get is_accessible() { return Boolean(this.block_info.is_accessible); }
    set is_accessible(val) { this.block_info.is_accessible = Boolean(val); }
    get is_deletion() { return Boolean(this.block_info.is_deletion); }
    set is_deletion(val) { this.block_info.is_deletion = Boolean(val); }
    get is_future_deletion() { return Boolean(this.block_info.is_future_deletion); }
    set is_future_deletion(val) { this.block_info.is_future_deletion = Boolean(val); }

    // get is_misplaced() { return false; }
    // get is_missing() { return false; }
    // get is_tampered() { return false; }
    // get is_local_mirror() { return false; }

    /**
     * @param {nb.Frag} frag
     * @param {nb.Chunk} chunk
     */
    set_parent_ids(frag, chunk) {
        this.chunk_id = chunk._id;
        this.frag_id = frag._id;
        this.bucket_id = chunk.bucket_id;
    }

    /**
     * @param {nb.NodeAPI} node
     */
    set_node(node) {
        /** @type {nb.Pool} */
        const pool = this.system_store.data.systems[0].pools_by_name[node.pool];
        this.node = node;
        this.block_md.node = node._id.toHexString();
        this.block_md.pool = pool._id.toHexString();
        this.block_md.address = node.rpc_address;
        this.block_md.node_type = node.node_type;
        const adminfo = this.block_info.adminfo;
        if (adminfo) {
            adminfo.pool_name = pool.name;
            adminfo.node_name = node.name;
            adminfo.node_ip = node.ip;
            adminfo.host_name = node.os_info.hostname;
            adminfo.mount = node.drive.mount;
            adminfo.online = Boolean(node.online);
            adminfo.in_cloud_pool = Boolean(node.is_cloud_node);
            adminfo.in_mongo_pool = Boolean(node.is_mongo_node);
        }
    }

    set_digest_type() {
        throw new Error(`BlockAPI.set_digest_type: unexpected call - used just for testing in BlockDB`);
    }

    to_block_md() {
        return this.block_md;
    }

    /** @returns {nb.BlockInfo} */
    to_api() {
        return this.block_info;
    }

    /** @returns {nb.BlockSchemaDB} */
    to_db() {
        return {
            _id: this._id,
            bucket: this.bucket_id,
            chunk: this.chunk_id,
            frag: this.frag_id,
            node: this.node_id,
            pool: this.pool_id,
            size: this.size,
            system: this.pool.system._id,
        };
    }
}

/**
 * @implements {nb.Part}
 */
class PartAPI {

    /**
     * @param {PartAPI} part
     * @returns {nb.Part}
     */
    static implements_interface(part) { return part; }

    /**
     * @param {nb.PartInfo} part_info
     * @param {nb.ID} bucket_id
     * @param {SystemStore} [system_store]
     */
    constructor(part_info, bucket_id, system_store) {
        this.part_info = part_info;
        this.system_store = system_store;
        this._id = undefined_id;
        this.bucket_id = bucket_id;
        PartAPI.implements_interface(this);
    }

    get obj_id() { return db_client.instance().parse_object_id(this.part_info.obj_id); }
    get chunk_id() { return db_client.instance().parse_object_id(this.part_info.chunk_id); }
    get multipart_id() { return parse_optional_id(this.part_info.multipart_id); }

    get start() { return this.part_info.start; }
    get end() { return this.part_info.end; }
    get seq() { return this.part_info.seq; }

    set_new_part_id() {
        if (this._id) throw new Error(`PartAPI.set_new_part_id: already has id ${this._id}`);
        this._id = db_client.instance().new_object_id();
    }

    /**
     * @param {nb.ID} chunk_id
     */
    set_chunk(chunk_id) { this.part_info.chunk_id = chunk_id.toHexString(); }

    /**
     * @param {nb.ID} obj_id
     */
    set_obj_id(obj_id) { this.part_info.obj_id = obj_id.toHexString(); }

    /** @returns {nb.PartInfo} */
    to_api() {
        return this.part_info;
    }

    /** @returns {nb.PartSchemaDB} */
    to_db() {
        /** @type {nb.Bucket} */
        const bucket = this.system_store.data.get_by_id(this.bucket_id);
        return {
            _id: this._id,
            system: bucket.system._id,
            bucket: bucket._id,
            chunk: this.chunk_id,
            obj: this.obj_id,
            multipart: this.multipart_id,
            seq: this.seq,
            start: this.start,
            end: this.end,
            uncommitted: this.part_info.uncommitted ? true : undefined,
        };
    }
}

/**
 * @param {nb.FragInfo} frag_info
 * @param {SystemStore} [system_store]
 */
function new_frag_api(frag_info, system_store) {
    return new FragAPI(frag_info, system_store);
}

/**
 * @param {nb.BlockInfo} block_info
 * @param {SystemStore} [system_store]
 */
function new_block_api(block_info, system_store) {
    return new BlockAPI(block_info, system_store);
}

/**
 * @param {nb.PartInfo} part_info
 * @param {nb.ID} bucket_id
 * @param {SystemStore} [system_store]
 */
function new_part_api(part_info, bucket_id, system_store) {
    return new PartAPI(part_info, bucket_id, system_store);
}

/**
 * @param {string} [optional_string]
 * @returns {nb.DBBuffer | undefined}
 */
function from_b64(optional_string) {
    if (optional_string) return Buffer.from(optional_string, 'base64');
}
/**
 *
 * @param {nb.Chunk[]} chunks
 * @returns {nb.Block[]}
 */
function get_all_chunks_blocks(chunks) {
    return /** @type {nb.Block[]} */ (
        /** @type {unknown} */
        (_.flatMapDeep(chunks, chunk => chunk.frags.map(frag => frag.blocks)))
    );
}
/**
 *
 * @param {nb.Chunk[]} chunks
 * @returns {nb.Part[]}
 */
function get_all_chunk_parts(chunks) {
    return chunks.flatMap(chunk => chunk.parts);
}

exports.ChunkAPI = ChunkAPI;
exports.FragAPI = FragAPI;
exports.BlockAPI = BlockAPI;
exports.get_all_chunks_blocks = get_all_chunks_blocks;
exports.get_all_chunk_parts = get_all_chunk_parts;
