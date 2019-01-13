/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const mocha = require('mocha');
const util = require('util');
const crypto = require('crypto');
const assert = require('assert');
const stream = require('stream');

const ObjectIO = require('../../sdk/object_io');

const { rpc_client } = coretest;
const object_io = new ObjectIO();
object_io.set_verification_mode();

const seed = crypto.randomBytes(16);
const generator = crypto.createCipheriv('aes-128-gcm', seed, Buffer.alloc(12));

coretest.describe_mapper_test_case({
    name: 'object_io',
    bucket_name_prefix: 'test-object-io',
}, ({
    test_name,
    bucket_name,
    data_placement,
    num_pools,
    replicas,
    data_frags,
    parity_frags,
    total_frags,
    total_blocks,
    total_replicas,
    chunk_coder_config,
}) => {

    // TODO we need to create more nodes and pools to support all MAPPER_TEST_CASES
    if (total_blocks > 10) return;

    const bucket = bucket_name;
    const KEY = 'test-object-io-key';

    let nodes_list;
    let key_counter = 1;
    let small_loops = 1;
    let medium_loops = 1;
    let big_loops = 0;
    if ((replicas === 3 && data_frags === 1 && parity_frags === 0) ||
        (replicas === 1 && data_frags === 4 && parity_frags === 2)) {
        small_loops = 10;
        medium_loops = 3;
        big_loops = 3;
    }

    mocha.before(async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const { nodes } = await rpc_client.node.list_nodes({});
        nodes_list = nodes;
    });

    // mocha.it.only('test1', async function() {
    //     await upload_and_verify(111);
    // });

    mocha.it('empty object', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const content_type = 'application/octet-stream';
        const content_type2 = 'text/plain';
        const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });
        await rpc_client.object.complete_object_upload({ obj_id, bucket, key });
        const object_md = await rpc_client.object.read_object_md({ bucket, key });
        assert.strictEqual(object_md.num_parts, 0);
        assert.strictEqual(object_md.capacity_size, 0);
        await rpc_client.object.update_object_md({ bucket, key, content_type: content_type2 });
        await rpc_client.object.list_objects_admin({ bucket, prefix: key });
        await rpc_client.object.delete_object({ bucket, key });
    });

    mocha.it.only('upload_and_verify', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        for (let i = 0; i < small_loops; ++i) await upload_and_verify(61);
        for (let i = 0; i < medium_loops; ++i) await upload_and_verify(4015);
        for (let i = 0; i < big_loops; ++i) await upload_and_verify(10326);
    });

    mocha.it.only('multipart_upload_and_verify', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        for (let i = 0; i < small_loops; ++i) await multipart_upload_and_verify(45, 7);
        for (let i = 0; i < medium_loops; ++i) await multipart_upload_and_verify(3245, 5);
        for (let i = 0; i < big_loops; ++i) await multipart_upload_and_verify(7924, 3);
    });


    async function upload_and_verify(size) {
        const data = generator.update(Buffer.alloc(size));
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const params = {
            client: rpc_client,
            bucket,
            key,
            size,
            content_type: 'application/octet-stream',
            source_stream: readable_buffer(data),
        };
        await object_io.upload_object(params);
        await verify_read_mappings(key, size);
        await verify_read_data(key, data, params.obj_id);
        await verify_nodes_mapping();
        await rpc_client.object.delete_object({ bucket, key });
        console.log('upload_and_verify: OK', size);
    }

    async function multipart_upload_and_verify(part_size, num_parts) {
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const content_type = 'test/test';
        const size = num_parts * part_size;
        const data = generator.update(Buffer.alloc(size));
        const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });

        const mp_list_before = await rpc_client.object.list_multiparts({ obj_id, bucket, key });
        console.log('list_multiparts before', mp_list_before);
        assert.strictEqual(mp_list_before.multiparts.length, 0);

        const get_part_slice = i => data.slice(i * part_size, (i + 1) * part_size);

        const upload_multipart = (i, mp_data, split, finish) =>
            object_io.upload_multipart({
                client: rpc_client,
                obj_id,
                bucket,
                key,
                num: i + 1,
                size: mp_data.length,
                source_stream: readable_buffer(mp_data, split, finish),
            });

        // upload multiparts with different data that fail before they finish.
        // this is an attempt to reproduce an issue that left unfinished multiparts,
        // and when left in wrong offsets it will return bad data on read.
        await Promise.all(_.times(num_parts,
            i => upload_multipart(i, generator.update(Buffer.alloc(part_size)), 4, 'fail').catch(err => ({ err }))
        ));

        // upload multiparts with different data that completes.
        // we expect that complete_object_upload will remove these since we do not send their etags.
        await Promise.all(_.times(num_parts,
            i => upload_multipart(i, generator.update(Buffer.alloc(part_size)))
        ));

        // upload the real multiparts we want to complete with
        const multiparts = await Promise.all(_.times(num_parts,
            i => upload_multipart(i, get_part_slice(i))
        ));

        // again upload multiparts with different data that fail before they finish.
        await Promise.all(_.times(num_parts,
            i => upload_multipart(i, generator.update(Buffer.alloc(part_size)), 4, 'fail').catch(err => ({ err }))
        ));

        const mp_list_after = await rpc_client.object.list_multiparts({ obj_id, bucket, key });
        console.log('list_multiparts after', mp_list_after);
        assert.strictEqual(mp_list_after.multiparts.length, num_parts);
        assert.deepStrictEqual(
            mp_list_after.multiparts.map(mp => mp.etag),
            multiparts.map(mp => mp.etag)
        );

        await rpc_client.object.complete_object_upload({
            obj_id,
            bucket,
            key,
            multiparts: multiparts.map((mp, i) => ({ num: i + 1, etag: mp.etag }))
        });

        await verify_read_mappings(key, size);
        await verify_read_data(key, data, obj_id);
        await verify_nodes_mapping();
        await rpc_client.object.delete_object({ bucket, key });
        console.log('multipart_upload_and_verify: OK', part_size, num_parts);
    }

    async function verify_read_mappings(key, size) {
        /** @type {{ chunks: nb.ChunkInfo[]}} */
        const { chunks } = await rpc_client.object.read_object_mapping_admin({ bucket, key });
        let pos = 0;
        for (const chunk of chunks) {
            const frags = chunk.frags;
            const part = chunk.parts[0];
            const { start, end } = part;
            // console.log(`TODO GGG READ PART pos=${pos}`, JSON.stringify(part));
            assert.strictEqual(start, pos);
            pos = end;
            assert.strictEqual(frags.length, total_frags);
            for (const frag of frags) {
                // assert.strictEqual(frag.allocations, undefined);
                assert.strictEqual(frag.blocks.length, replicas, util.inspect(frag));
            }
            // check blocks don't repeat in the same chunk
            const part_blocks = _.flatMap(frags, 'blocks');
            const blocks_per_node = _.groupBy(part_blocks, block => block.adminfo.node_name);
            for (const blocks of Object.values(blocks_per_node)) {
                assert.strictEqual(blocks.length, 1);
            }
        }
        assert.strictEqual(pos, size);
    }

    async function verify_read_data(key, data, obj_id) {
        const object_md = await rpc_client.object.read_object_md({ bucket, key, obj_id });
        const read_buf = await object_io.read_entire_object({ client: rpc_client, object_md });
        // verify the read buffer equals the written buffer
        assert.strictEqual(data.length, read_buf.length);
        for (let i = 0; i < data.length; i++) {
            assert.strictEqual(data[i], read_buf[i], `mismatch data at pos ${i}`);
        }
    }

    async function verify_nodes_mapping() {
        await Promise.all([
            ...nodes_list.map(node =>
                rpc_client.object.read_node_mapping({
                    name: node.name,
                    adminfo: true,
                })
            ),
            ...nodes_list.map(node =>
                rpc_client.object.read_node_mapping({
                    name: `${node.os_info.hostname}#${node.host_seq}`,
                    by_host: true,
                    adminfo: true,
                })
            )
        ]);
    }

    function readable_buffer(data, split = 1, finish = 'end') {
        const max = Math.ceil(data.length / split);
        let pos = 0;
        return new stream.Readable({
            read() {
                if (pos < data.length) {
                    const len = Math.min(data.length - pos, max);
                    const buf = data.slice(pos, pos + len);
                    pos += len;
                    setImmediate(() => this.push(buf));
                } else if (finish === 'fail') {
                    this.emit('error', new Error('TEST_OBJECT_IO FAIL ON FINISH'));
                } else {
                    this.push(null);
                }
            }
        });
    }

});
