'use strict';

const _ = require('lodash');
const argv = require('minimist')(process.argv);
const crypto = require('crypto');
const P = require('../util/promise');
const api = require('../api');
const dbg = require('../util/debug_module')(__filename);

const rpc = api.new_rpc();
const client = rpc.new_client();

argv.email = argv.email || 'demo@noobaa.com';
argv.password = argv.password || 'DeMo1';
argv.system = argv.system || 'demo';
argv.bucket = argv.bucket || 'files';
argv.count = argv.count || 100;
argv.chunks = argv.chunks || 128;
argv.chunk_size = argv.chunk_size || 1024 * 1024;
argv.concur = argv.concur || 20;
argv.key = argv.key || ('md_blow-' + Date.now().toString(36));

main();

function main() {
    return client.create_auth_token({
            email: argv.email,
            password: argv.password,
            system: argv.system,
        })
        .then(() => blow_objects())
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

function blow_objects() {
    let index = 0;

    function blow_next() {
        if (index >= argv.count) return;
        index += 1;
        return blow_object(index).then(blow_next);
    }
    return P.all(_.times(argv.concur, blow_next));
}

function blow_object(index) {
    const params = {
        bucket: argv.bucket,
        key: argv.key + '-' + index,
        size: argv.chunks * argv.chunk_size,
        content_type: 'application/octet_stream'
    };
    dbg.log0('create_object_upload', params.key);
    return client.object.create_object_upload(params)
        .then(create_reply => {
            params.upload_id = create_reply.upload_id;
            return blow_parts(params);
        })
        .then(() => {
            let complete_params = _.pick(params, 'bucket', 'key', 'upload_id');
            dbg.log0('complete_object_upload', params.key);
            return client.object.complete_object_upload(complete_params);
        });
}

function blow_parts(params) {
    dbg.log0('allocate_object_parts', params.key);
    return client.object.allocate_object_parts({
            bucket: params.bucket,
            key: params.key,
            upload_id: params.upload_id,
            parts: _.times(argv.chunks, i => ({
                start: i * argv.chunk_size,
                end: (i + 1) * argv.chunk_size,
                seq: i,
                chunk: {
                    size: argv.chunk_size,
                    compress_size: argv.chunk_size,
                    data_frags: 1,
                    lrc_frags: 0,
                    digest_type: '',
                    digest_b64: crypto.randomBytes(16).toString('base64'),
                    cipher_type: '',
                    cipher_key_b64: '',
                    frags: [{
                        size: argv.chunk_size,
                        layer: 'D',
                        frag: 0,
                        digest_type: '',
                        digest_b64: crypto.randomBytes(16).toString('base64'),
                    }]
                }
            }))
        })
        .then(res => {
            dbg.log0('finalize_object_parts', params.key);
            return client.object.finalize_object_parts({
                bucket: params.bucket,
                key: params.key,
                upload_id: params.upload_id,
                parts: res.parts
            });
        });
}
