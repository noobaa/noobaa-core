/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');

const P = require('../../util/promise');
const ObjectIO = require('../../sdk/object_io');
const SliceReader = require('../../util/slice_reader');
const promise_utils = require('../../util/promise_utils');

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
    if (data_placement !== 'SPREAD' || num_pools !== 1 || total_blocks > 10) return;

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

    mocha.before(function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => rpc_client.node.list_nodes({}))
            .then(res => {
                nodes_list = res.nodes;
            });
    });

    mocha.it('empty object', function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const content_type = 'application/octet-stream';
        const content_type2 = 'text/plain';
        return P.resolve()
            .then(() => rpc_client.object.create_object_upload({ bucket, key, content_type }))
            .then(create_reply => rpc_client.object.complete_object_upload({
                obj_id: create_reply.obj_id,
                bucket,
                key,
            }))
            .then(() => rpc_client.object.read_object_md({ bucket, key, adminfo: {} })
                .then(object_md => {
                    assert.strictEqual(object_md.num_parts, 0);
                    assert.strictEqual(object_md.capacity_size, 0);
                })
            )
            .then(() => rpc_client.object.update_object_md({ bucket, key, content_type: content_type2 }))
            .then(() => rpc_client.object.list_objects_fe({ bucket, prefix: key }))
            .then(() => rpc_client.object.delete_object({ bucket, key }));
    });

    mocha.it('upload_and_verify', function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => promise_utils.loop(small_loops, () => upload_and_verify(61)))
            .then(() => promise_utils.loop(medium_loops, () => upload_and_verify(4015)))
            .then(() => promise_utils.loop(big_loops, () => upload_and_verify(10326)));
    });

    mocha.it('multipart_upload_and_verify', function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        return P.resolve()
            .then(() => promise_utils.loop(small_loops, () => multipart_upload_and_verify(45, 7)))
            .then(() => promise_utils.loop(medium_loops, () => multipart_upload_and_verify(3245, 5)))
            .then(() => promise_utils.loop(big_loops, () => multipart_upload_and_verify(7924, 3)));
    });


    function upload_and_verify(size) {
        const data = generator.update(Buffer.alloc(size));
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        return P.resolve()
            .then(() => object_io.upload_object({
                client: rpc_client,
                bucket,
                key,
                size,
                content_type: 'application/octet-stream',
                source_stream: new SliceReader(data),
            }))
            .then(() => verify_read_data(key, data))
            .then(() => verify_read_mappings(key, size))
            .then(() => verify_nodes_mappings(nodes_list))
            .then(() => rpc_client.object.delete_object({ bucket, key }))
            .then(() => console.log('upload_and_verify: OK', size));
    }

    function multipart_upload_and_verify(part_size, num_parts) {
        let obj_id;
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const content_type = 'test/test';
        const size = num_parts * part_size;
        const data = generator.update(Buffer.alloc(size));
        return P.resolve()
            .then(() => rpc_client.object.create_object_upload({ bucket, key, content_type }))
            .then(create_reply => {
                obj_id = create_reply.obj_id;
            })
            .then(() => rpc_client.object.list_multiparts({ obj_id, bucket, key }))
            .tap(list => console.log('list_multiparts reply', list))
            .then(list => P.map(_.times(num_parts),
                i => object_io.upload_multipart({
                    client: rpc_client,
                    obj_id,
                    bucket,
                    key,
                    num: i + 1,
                    size: part_size,
                    source_stream: new SliceReader(data, {
                        start: i * part_size,
                        end: (i + 1) * part_size
                    }),
                })
            ))
            .then(() => rpc_client.object.list_multiparts({ obj_id, bucket, key }))
            .tap(list => console.log('list_multiparts reply', list))
            .then(list => rpc_client.object.complete_object_upload({
                obj_id,
                bucket,
                key,
                multiparts: _.map(list.multiparts, p => _.pick(p, 'num', 'etag'))
            }))
            .then(() => verify_read_data(key, data))
            .then(() => verify_read_mappings(key, size))
            .then(() => verify_nodes_mappings())
            .then(() => rpc_client.object.delete_object({ bucket, key }))
            .then(() => console.log('multipart_upload_and_verify: OK', part_size, num_parts));
    }

    function verify_read_mappings(key, size) {
        return rpc_client.object.read_object_mappings({ bucket, key, adminfo: true })
            .then(({ parts }) => {
                let pos = 0;
                parts.forEach(part => {
                    const { start, end, chunk: { frags } } = part;
                    assert.strictEqual(start, pos);
                    pos = end;
                    assert.strictEqual(frags.length, total_frags);
                    _.forEach(frags, frag => assert.strictEqual(frag.blocks.length, replicas));
                    // check blocks don't repeat in the same chunk
                    const part_blocks = _.flatMap(frags, 'blocks');
                    const blocks_per_node = _.groupBy(part_blocks, block => block.adminfo.node_name);
                    _.forEach(blocks_per_node, (b, node_name) => assert.strictEqual(b.length, 1));
                });
                assert.strictEqual(pos, size);
            });
    }

    function verify_read_data(key, data) {
        return object_io.read_entire_object({ client: rpc_client, bucket, key })
            .then(read_buf => {
                // verify the read buffer equals the written buffer
                assert.strictEqual(data.length, read_buf.length);
                for (let i = 0; i < data.length; i++) {
                    assert.strictEqual(data[i], read_buf[i], `mismatch data at pos ${i}`);
                }
            });
    }

    function verify_nodes_mappings() {
        return P.map(nodes_list, node => P.join(
            rpc_client.object.read_node_mappings({
                name: node.name,
                adminfo: true
            }),
            rpc_client.object.read_host_mappings({
                name: `${node.os_info.hostname}#${node.host_seq}`,
                adminfo: true
            })
        ));
    }

});
