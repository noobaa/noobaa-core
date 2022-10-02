/* Copyright (C) 2020 NooBaa */
'use strict';

const crypto = require('crypto');
const assert = require('assert');
const ChunkFS = require('../util/chunk_fs');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const stream_utils = require('../util/stream_utils');
const P = require('../util/promise');
const stream = require('stream');
const fs = require('fs');
const argv = require('minimist')(process.argv);
const path = require('path');

const XATTR = argv.xattr || true;
const FSYNC = argv.fsync || true;
const PARTS = Number(argv.parts) || 1000;
const CONCURRENCY = Number(argv.concurrency) || 20;
const CHUNK = Number(argv.chunk) || 16 * 1024;
const PART_SIZE = Number(argv.part_size) || 20 * 1024 * 1024;
const F_PREFIX = argv.dst_folder || '/tmp/chunk_fs_hashing/';

const DEFAULT_FS_CONFIG = {
    uid: Number(argv.uid) || process.getuid(),
    gid: Number(argv.gid) || process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};

const DUMMY_RPC = {
    object: {
        update_endpoint_stats: (...params) => null
    }
};

const XATTR_USER_PREFIX = 'user.';
// TODO: In order to verify validity add content_md5_mtime as well
const XATTR_MD5_KEY = XATTR_USER_PREFIX + 'content_md5';

class TargetHash {
    constructor() {
        this.hash = crypto.createHash('md5');
    }
    digest() {
        return this.hash.digest('hex');
    }
    async writev(_config, buffers) {
        await P.delay(100);
        for (const buf of buffers) this.hash.update(buf);
    }
}

function get_umasked_mode(mode) {
    // eslint-disable-next-line no-bitwise
    return mode & ~config.NSFS_UMASK;
}

function assign_md5_to_fs_xattr(md5_digest, fs_xattr) {
    // TODO: Assign content_md5_mtime
    fs_xattr = Object.assign(fs_xattr || {}, {
        [XATTR_MD5_KEY]: md5_digest
    });
    return fs_xattr;
}

async function hash_target() {
    await P.map_with_concurrency(CONCURRENCY, Array(PARTS).fill(), async () => {
        const data = crypto.randomBytes(PART_SIZE);
        const content_md5 = crypto.createHash('md5').update(data).digest('hex');
        // Using async generator function in order to push data in small chunks
        const source_stream = stream.Readable.from(async function*() {
            for (let i = 0; i < data.length; i += CHUNK) {
                yield data.slice(i, i + CHUNK);
            }
        }());
        const target = new TargetHash();
        const chunk_fs = new ChunkFS({
            target_file: target,
            fs_context: DEFAULT_FS_CONFIG,
            rpc_client: DUMMY_RPC,
            namespace_resource_id: 'MajesticSloth'
        });
        await stream_utils.pipeline([source_stream, chunk_fs]);
        await stream_utils.wait_finished(chunk_fs);
        const write_hash = target.digest();
        console.log(
            'Hash target',
            `NativeMD5=${chunk_fs.digest}`,
            `DataWriteCryptoMD5=${write_hash}`,
            `DataOriginMD5=${content_md5}`,
        );
        assert.strictEqual(content_md5, write_hash);
        if (config.NSFS_CALCULATE_MD5) {
            assert.strictEqual(chunk_fs.digest, content_md5);
            assert.strictEqual(chunk_fs.digest, write_hash);
        }
    });
}

async function file_target(chunk_size = CHUNK, parts = PARTS) {
    fs.mkdirSync(F_PREFIX);
    await P.map_with_concurrency(CONCURRENCY, Array(parts).fill(), async () => {
        let target_file;
        const data = crypto.randomBytes(PART_SIZE);
        const content_md5 = crypto.createHash('md5').update(data).digest('hex');
        const F_TARGET = path.join(F_PREFIX, content_md5);
        try {
            target_file = await nb_native().fs.open(DEFAULT_FS_CONFIG, F_TARGET, 'w', get_umasked_mode(config.BASE_MODE_FILE));
            // Using async generator function in order to push data in small chunks
            const source_stream = stream.Readable.from(async function*() {
                for (let i = 0; i < data.length; i += chunk_size) {
                    yield data.slice(i, i + chunk_size);
                }
            }());
            const chunk_fs = new ChunkFS({
                target_file,
                fs_context: DEFAULT_FS_CONFIG,
                rpc_client: DUMMY_RPC,
                namespace_resource_id: 'MajesticSloth'
            });
            await stream_utils.pipeline([source_stream, chunk_fs]);
            await stream_utils.wait_finished(chunk_fs);
            if (XATTR) {
                await target_file.replacexattr(
                    DEFAULT_FS_CONFIG,
                    assign_md5_to_fs_xattr(chunk_fs.digest, {})
                );
            }
            if (FSYNC) await target_file.fsync(DEFAULT_FS_CONFIG);
            const write_hash = crypto.createHash('md5').update(fs.readFileSync(F_TARGET)).digest('hex');
            console.log(
                'File target',
                `NativeMD5=${chunk_fs.digest}`,
                `DataWriteMD5=${write_hash}`,
                `DataOriginMD5=${content_md5}`,
            );
            assert.strictEqual(content_md5, write_hash);
            if (config.NSFS_CALCULATE_MD5) {
                assert.strictEqual(chunk_fs.digest, content_md5);
                assert.strictEqual(chunk_fs.digest, write_hash);
            }
            // Leave parts on error
            fs.rmSync(F_TARGET);
        } finally {
            if (target_file) {
                await target_file.close(DEFAULT_FS_CONFIG);
            }
        }
    });
    // Leave parts on error
    fs.rmdirSync(F_PREFIX);
}

if (require.main === module) {
    if (argv.file) file_target();
    if (argv.hash) hash_target();
}

exports.file_target = file_target;
exports.hash_target = hash_target;
