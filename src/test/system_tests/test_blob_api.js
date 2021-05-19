/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');
const crypto = require('crypto');

const buffer_utils = require('../../util/buffer_utils');
const dotenv = require('../../util/dotenv');
dotenv.load();

const azure_storage = require('azure-storage');

const blob_service = azure_storage.createBlobService('account', '1234', 'http://localhost:80');
// const blob_service = azure_storage.createBlobService();


const TEST_CTX = {
    container: `test-blob-api-${Date.now()}`,
    block_size: 1024 * 1024, // 1MB block size
    block_count: 10,
};


async function upload_blocks({ blocks, container, blob }) {
    await P.all(blocks.map(block => P.fromCallback(callback => blob_service.createBlockFromText(
        block.block_id,
        container,
        blob,
        block.buffer,
        callback))));
}

async function commit_block_list({ block_list, list_type = 'UncommittedBlocks', container, blob } = {}) {
    const blocks_to_commit = {};
    blocks_to_commit[list_type] = block_list;
    await P.fromCallback(callback => blob_service.commitBlocks(container, blob, blocks_to_commit, callback));
}

function generate_random_blocks({ block_count, block_size }) {
    // const = params;
    const block_id_prefix = blob_service.generateBlockIdPrefix();
    const blocks = [];
    for (let i = 0; i < block_count; ++i) {
        const buf = crypto.randomBytes(block_size);
        const block_id = blob_service.getBlockId(block_id_prefix, i);
        blocks.push({ block_id, buffer: buf });
    }
    return blocks;
}

function calc_block_list_md5(blocks) {
    const md5_hash = crypto.createHash('md5');
    blocks.forEach(block => {
        md5_hash.update(block.buffer);
    });
    return md5_hash.digest('hex');
}


async function test_upload_blocks_and_commit_by_order() {
    try {
        const { container, block_count, block_size } = TEST_CTX;
        const blob = `test_upload_blocks_and_commit_by_order-${Date.now()}`;
        const blocks = generate_random_blocks({ block_count, block_size });
        await upload_blocks({ blocks, container, blob });
        await commit_block_list({
            block_list: blocks.map(block => block.block_id),
            blob,
            container
        });
        await compare_md5(blocks, container, blob);
        console.log('PASSED - test_upload_blocks_and_commit_by_order');
    } catch (err) {
        console.error('FAILED - test_upload_blocks_and_commit_by_order');
        throw err;
    }
}


async function test_upload_blocks_and_recommit_reverse_order() {
    try {
        const { container, block_count, block_size } = TEST_CTX;
        const blob = `test_upload_blocks_and_recommit_reverse_order-${Date.now()}`;
        const blocks = generate_random_blocks({ block_count, block_size });
        await upload_blocks({ blocks, container, blob });
        await commit_block_list({
            block_list: blocks.map(block => block.block_id),
            blob,
            container
        });
        // now recommit from commited blocks but in reverse order
        blocks.reverse();
        await commit_block_list({
            block_list: blocks.map(block => block.block_id),
            blob,
            container,
            list_type: 'CommittedBlocks'
        });
        await compare_md5(blocks, container, blob);
        console.log('PASSED - test_upload_blocks_and_recommit_reverse_order');
    } catch (err) {
        console.log('FAILED - test_upload_blocks_and_recommit_reverse_order');
        throw err;
    }
}

// reupload a single block with the same blockid and different data.
// commit with "Latest" list type
async function test_upload_blocks_and_modify_single_block() {
    try {
        const { container, block_count, block_size } = TEST_CTX;
        const blob = `test_upload_blocks_and_modify_single_block-${Date.now()}`;
        const blocks = generate_random_blocks({ block_count, block_size });
        await upload_blocks({ blocks, container, blob });
        await commit_block_list({
            block_list: blocks.map(block => block.block_id),
            blob,
            container
        });
        // modify single block and recommit as latest
        blocks[4].buffer = crypto.randomBytes(block_size);
        await upload_blocks({ blocks: [blocks[4]], container, blob });
        await commit_block_list({
            block_list: blocks.map(block => block.block_id),
            blob,
            container,
            list_type: 'LatestBlocks'
        });
        await compare_md5(blocks, container, blob);
        console.log('PASSED - test_upload_blocks_and_modify_single_block');
    } catch (err) {
        console.log('FAILED - test_upload_blocks_and_modify_single_block');
        throw err;
    }
}


async function compare_md5(blocks, container, blob) {
    const md5 = calc_block_list_md5(blocks);
    // download blob and compare md5
    const dl_buf = await buffer_utils.read_stream_join(blob_service.createReadStream(container, blob));
    const dl_md5 = crypto.createHash('md5').update(dl_buf).digest('hex');
    if (dl_md5 !== md5) {
        throw new Error(`md5 does not match. blocks md5 (${md5}) downloaded md5 (${dl_md5})`);
    }
}

async function setup() {
    console.log('creating test container', TEST_CTX.container);
    await P.fromCallback(callback => blob_service.createContainer(TEST_CTX.container, callback));
}


async function run_test() {
    await setup();
    await test_upload_blocks_and_commit_by_order();
    await test_upload_blocks_and_recommit_reverse_order();
    await test_upload_blocks_and_modify_single_block();
}


async function main() {
    try {
        await run_test();
        console.log('test_blob_api PASSED');
        process.exit(0);
    } catch (err) {
        console.error('test_blob_api FAILED', err);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
