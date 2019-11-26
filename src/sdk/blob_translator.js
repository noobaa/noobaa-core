/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../util/debug_module')(__filename);
const P = require('../util/promise');
const buffer_utils = require('../util/buffer_utils');
const BlobError = require('../endpoint/blob/blob_errors').BlobError;



const BLOCKS_INFO_PATH = '.noobaa_blob';


function get_uncommitted_blocks_path(bucket, key) {
    return `${BLOCKS_INFO_PATH}/${bucket}/${key}/uncommitted_blocks/`;
}

function get_committed_blocks_path(bucket, key) {
    return `${BLOCKS_INFO_PATH}/${bucket}/${key}/committed_blocks.json`;
}

async function upload_blob_block(params, object_sdk) {
    // use the path .noobaa_blob_blocks/KEY/uncommitted to store data of uncommited blocks
    const block_key = `${get_uncommitted_blocks_path(params.bucket, params.key)}/${params.block_id}`;
    return object_sdk.upload_object({
        bucket: params.bucket,
        key: block_key,
        source_stream: params.source_stream,
        size: params.size,
    });
}




async function get_committed_list(params, object_sdk) {
    try {
        const key = get_committed_blocks_path(params.bucket, params.key);
        const object_md = await object_sdk.read_object_md({
            bucket: params.bucket,
            key
        });
        const read_stream = await object_sdk.read_object_stream({
            object_md,
            obj_id: object_md.obj_id,
            bucket: params.bucket,
            key,
        });
        const data_buffer = await buffer_utils.read_stream_join(read_stream);
        return JSON.parse(data_buffer);
    } catch (err) {
        dbg.warn(`got error on reading committed list for params`, params, err);
        return [];
    }
}

async function get_uncommitted_list(params, object_sdk) {
    try {
        const uncommitted_path = get_uncommitted_blocks_path(params.bucket, params.key);
        const obj_list = [];
        let next_marker;
        let is_truncated = true;

        while (is_truncated) {
            const list_res = await object_sdk.list_objects({
                bucket: params.bucket,
                prefix: uncommitted_path,
                key_marker: next_marker,
            });
            obj_list.push(...list_res.objects);
            next_marker = list_res.next_marker;
            is_truncated = list_res.is_truncated;
        }
        return obj_list.map(obj => ({
            block_id: obj.key.replace(uncommitted_path + '/', ''),
            size: obj.size
        }));
    } catch (err) {
        dbg.warn(`got error on reading committed list for params`, params, err);
        return [];
    }
}


async function write_committed_list(block_list, bucket, key, object_sdk) {
    const committed_path = get_committed_blocks_path(bucket, key);
    const committed_blocks = block_list.map(block => _.omit(block, 'copy_source'));
    const buf = Buffer.from(JSON.stringify(committed_blocks));
    const upload_params = {
        bucket: bucket,
        key: committed_path,
        source_stream: buffer_utils.buffer_to_read_stream(buf),
        size: buf.length,
    };
    return object_sdk.upload_object(upload_params);
}


function process_block_list({ block_list, bucket, key, committed_list, uncommitted_list }) {
    const blocks_by_id = {};
    let start_offset = 0;
    committed_list.forEach(item => {
        blocks_by_id[item.block_id] = Object.assign(item, { block_type: 'committed' });
    });
    uncommitted_list.forEach(item => {
        blocks_by_id[item.block_id] = Object.assign(item, { block_type: 'uncommitted' });
    });

    return block_list.map(block => {
        const resolved_block = blocks_by_id[block.block_id];
        if (block.type !== resolved_block.block_type && block.type !== 'latest') throw new BlobError(BlobError.InvalidBlobOrBlock);
        const end_offset = start_offset + resolved_block.size;
        const range = { start: start_offset, end: end_offset };
        start_offset = end_offset;
        let copy_source;
        if (resolved_block.block_type === 'uncommitted') {
            copy_source = {
                bucket,
                key: `${get_uncommitted_blocks_path(bucket, key)}/${block.block_id}`,
            };
        } else {
            copy_source = {
                bucket,
                key,
                ranges: [resolved_block.range],
            };
        }
        return {
            block_id: block.block_id,
            copy_source,
            num: block.num,
            size: resolved_block.size,
            range
        };
    });
}

async function remove_block_lists(object_sdk, { bucket, key, uncommitted_list, remove_uncommitted, remove_committed}) {
    const uncommitted_path = get_uncommitted_blocks_path(bucket, key);
    const objects = remove_uncommitted ? uncommitted_list.map(block => ({ key: `${uncommitted_path}/${block.block_id}` })) : [];
    if (remove_committed) {
        const committed_path = get_committed_blocks_path(bucket, key);
        objects.push({ key: committed_path });
    }
    if (!objects.length) return;
    return object_sdk.delete_multiple_objects({ bucket, objects });
}


async function commit_blob_block_list(params, object_sdk) {
    // initiate multipart upload
    const { bucket, key } = params;
    dbg.log1(`creating multipart upload for bucket:${bucket}, key:${key}`);
    const [committed_list, uncommitted_list, init_multipart_res] = await P.all([
        get_committed_list({ bucket, key }, object_sdk),
        get_uncommitted_list({ bucket, key }, object_sdk),
        object_sdk.create_object_upload({
            bucket,
            key,
            content_type: params.content_type,
            xattr: params.xattr
            // TODO: check more params to send
        })
    ]);

    const { obj_id } = init_multipart_res;
    const final_block_list = process_block_list({
        bucket,
        key,
        block_list: params.block_list,
        committed_list,
        uncommitted_list
    });

    // upload parts 
    await P.map(final_block_list, async block => {
        const multipart_params = {
            obj_id: obj_id,
            bucket,
            key,
            num: block.num,
            copy_source: block.copy_source
        };
        const { etag } = await object_sdk.upload_multipart(multipart_params);
        block.etag = etag;
    });

    const multiparts = final_block_list.map(block => ({ num: block.num, etag: block.etag }));
    const [, res] = await P.all([
        write_committed_list(final_block_list, bucket, key, object_sdk),
        object_sdk.complete_object_upload({
            obj_id,
            bucket,
            key,
            multiparts
        })
    ]);

    await remove_block_lists(object_sdk, {
        bucket,
        key,
        uncommitted_list,
        remove_uncommitted: true,
        remove_committed: false
    });

    return res;
}


async function get_blob_block_lists(params, object_sdk) {
    const [committed_list, uncommitted_list] = await P.all([
        params.requested_lists.committed ?
        get_committed_list({ bucket: params.bucket, key: params.key }, object_sdk) : P.resolve(),
        params.requested_lists.uncommitted ?
        get_uncommitted_list({ bucket: params.bucket, key: params.key }, object_sdk) : P.resolve()
    ]);


    const res = _.omitBy({
        committed: committed_list ? committed_list.map(block => _.pick(block, 'block_id', 'size')) : undefined,
        uncommitted: uncommitted_list ? uncommitted_list.map(block => _.pick(block, 'block_id', 'size')) : undefined,
    }, _.isUndefined);

    return res;
}


async function delete_blocks(object_sdk, { bucket, keys } = {}) {
    // get all uncommitted\committed lists for all keys
    const block_lists = await P.map(keys, async key => {
        const lists = await get_blob_block_lists({
            bucket,
            key,
            requested_lists: {
                uncommitted: true
            }
        }, object_sdk);
        const uncommitted_path = get_uncommitted_blocks_path(bucket, key);
        const committed_path = get_committed_blocks_path(bucket, key);
        const delete_objects = lists.uncommitted.map(block => ({ key: `${uncommitted_path}/${block.block_id}` }));
        delete_objects.push({ key: committed_path });
        return delete_objects;
    });
    const all_objects = _.flatten(block_lists);
    // pass skip_blocks_delete to avoid recursion 
    if (!all_objects.length) return;
    await object_sdk.delete_multiple_objects({ bucket, objects: all_objects, skip_blocks_delete: true });
}


exports.upload_blob_block = upload_blob_block;
exports.commit_blob_block_list = commit_blob_block_list;
exports.get_blob_block_lists = get_blob_block_lists;
exports.delete_blocks = delete_blocks;
exports.remove_block_lists = remove_block_lists;
