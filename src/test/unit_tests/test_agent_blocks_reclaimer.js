/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const config = require('../../../config');
const db_client = require('../../util/db_client');
const schema_utils = require('../../util/schema_utils');
const MDStore = require('../../server/object_services/md_store').MDStore;
const ObjectIO = require('../../sdk/object_io');
const SliceReader = require('../../util/slice_reader');
const AgentBlocksReclaimer = require('../../server/bg_services/agent_blocks_reclaimer').AgentBlocksReclaimer;

class ReclaimerMock extends AgentBlocksReclaimer {

    constructor(blocks = [], nodes = [], test_suffix = '') {
        super(`ReclaimerMock-${test_suffix}`);
        coretest.log('ReclaimerMock INIT', test_suffix, blocks, nodes);
        this.blocks = blocks;
        this.nodes = nodes;
        this.reclaimed_blocks = [];
    }

    iterate_all_blocks(marker, limit, deleted_only) {
        assert(marker === undefined || marker === null || this.is_valid_md_id(marker),
            'Marker not null or valid ObjectId');
        assert(limit === config.AGENT_BLOCKS_RECLAIMER_BATCH_SIZE, 'Wrong reclaimer config limit');
        assert(deleted_only === true, 'Reclaimer should check only deleted and non reclaimed blocks');
        // TODO: Pay attention to marker and limit
        return P.resolve(this.blocks.filter(block => (deleted_only ? block.deleted : !block.deleted)));
    }

    update_blocks_by_ids(block_ids, set_updates, unset_updates) {
        assert(!unset_updates, 'Reclaimer should only send set_updates');
        assert(set_updates &&
            _.difference(Object.keys(set_updates), ['reclaimed']).length === 0,
            'Reclaimer should only send set_updates with reclaimed');
        assert(_.every(block_ids, block_id =>
            this.is_valid_md_id(block_id)), 'Block_ids not valid ObjectId');
        return P.resolve()
            .then(() => {
                if (!block_ids || !block_ids.length) return;
                const update_blocks = this.blocks.filter(block =>
                    _.includes(block_ids.map(block_id => String(block_id)), String(block._id)));
                update_blocks.forEach(block => {
                    block.reclaimed = set_updates.reclaimed;
                });
            });
    }

    is_valid_md_id(id_str) {
        return schema_utils.is_object_id(id_str);
    }

    populate_nodes_for_blocks(blocks) {
        const docs = blocks;
        const doc_path = 'node';
        // assert(doc_path === 'node',
        //     'Reclaimer should only send populate to node property of block');
        const docs_list = docs && !_.isArray(docs) ? [docs] : docs;
        const ids = db_client.instance().uniq_ids(docs_list, doc_path);
        if (!ids.length) return P.resolve(docs);


        return P.resolve()
            .then(() => this.nodes.filter(node => !node.deleted &&
                _.includes(ids.map(node_id => String(node_id)), String(node._id))))
            .then(nodes => {
                const idmap = _.keyBy(nodes, '_id');
                _.each(docs_list, doc => {
                    const id = _.get(doc, doc_path);
                    const node = idmap[String(id)];
                    if (node) {
                        db_client.instance().fix_id_type(node);
                        _.set(doc, doc_path, node);
                    } else {
                        console.warn('populate_nodes: missing node for id',
                            id, 'DOC', doc, 'IDMAP', _.keys(idmap));
                    }
                });
                return docs;
            })
            .catch(err => {
                console.error('populate_nodes: ERROR', err.stack);
                throw err;
            });
    }

    delete_blocks_from_nodes(blocks) {
        this.reclaimed_blocks = _.concat(this.reclaimed_blocks, blocks.map(block => String(block._id)));
        coretest.log('delete_blocks', blocks);
        return P.resolve()
            .then(() => {
                blocks.forEach(block_rec => {
                    let block = this.blocks.find(mock_block => String(mock_block._id) === String(block_rec._id));
                    // This allows us to mock failure of deletes
                    if (block && !block.fail_to_delete) {
                        block.reclaimed = new Date();
                    }
                });
            });
    }

}


mocha.describe('not mocked agent_blocks_reclaimer', function() {

    const object_io = new ObjectIO();
    object_io.set_verification_mode();
    const seed = crypto.randomBytes(16);
    const generator = crypto.createCipheriv('aes-128-gcm', seed, Buffer.alloc(12));
    const bucket = 'first.bucket';
    const obj_size = 1;
    const obj_data = generator.update(Buffer.alloc(obj_size));
    let nodes_list;
    const { rpc_client } = coretest;

    mocha.it('should reclaim deleted blocks with alive nodes', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(40000);
        const obj_key = 'sloth_obj';
        let obj_id;
        let blocks_uploaded = [];
        const agent_blocks_reclaimer =
            new AgentBlocksReclaimer(self.test.title);
        return P.resolve()
            .then(() => rpc_client.node.list_nodes({}))
            .then(res => {
                nodes_list = res.nodes;
            })
            .then(() => upload_object(obj_key, obj_data, obj_size))
            .then(id => {
                obj_id = id;
                return MDStore.instance().find_parts_chunk_ids({ _id: db_client.instance().parse_object_id(id) });
            })
            .then(chunk_ids => MDStore.instance().find_blocks_of_chunks(chunk_ids))
            .then(blocks => {
                blocks_uploaded = blocks;
                return MDStore.instance()._blocks.updateMany({
                    _id: { $in: blocks.map(block => block._id) }
                }, {
                    $set: { deleted: new Date() }
                });
            })
            .then(() => agent_blocks_reclaimer.run_batch())
            .then(() => P.pwhile(
                () => agent_blocks_reclaimer.marker,
                () => agent_blocks_reclaimer.run_batch()
            ))
            .then(() => MDStore.instance()._blocks.find({
                _id: { $in: blocks_uploaded.map(block => block._id) }
            }))
            .then(blocks => {
                // Object read cache still keeps the data and we want to read from agents
                object_io.set_verification_mode();
                const all_reclaimed = _.every(blocks, block => block.reclaimed);
                if (!all_reclaimed) throw new Error('NOT ALL BLOCKS WERE RECLAIMED');
            })
            .then(() => verify_read_data(obj_key, obj_data, obj_id)
                .then(
                    () => {
                        throw new Error('verify_read_data BLOCKS WERE NOT DELETED');
                    },
                    err =>
                    console.error('verify_read_data EXPECTED ERROR of deleted blocks:', err)
                )
            )
            .then(() => verify_read_mappings(obj_key, obj_data)
                .then(
                    () => {
                        throw new Error('verify_read_mappings BLOCKS WERE NOT DELETED');
                    },
                    err =>
                    console.error('verify_read_mappings EXPECTED ERROR of deleted blocks:', err)
                )
            )
            .catch(err => {
                console.error(err, err.stack);
                throw err;
            });
    });

    async function upload_object(key, data, size) {
        const params = {
            client: rpc_client,
            bucket,
            key,
            size,
            content_type: 'application/octet-stream',
            source_stream: new SliceReader(data),
        };
        await object_io.upload_object(params);
        await verify_read_data(key, data, params.obj_id);
        await verify_read_mappings(key, size);
        await verify_nodes_mapping();
        return params.obj_id;
    }

    function verify_read_mappings(key, size) {
        const total_frags = 1;
        const replicas = 1;
        return rpc_client.object.read_object_mapping_admin({ bucket, key })
            .then(({ chunks }) => {
                let pos = 0;
                chunks.forEach(chunk => {
                    const part = chunk.parts[0];
                    const { frags } = chunk;
                    const { start, end } = part;
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

    async function verify_read_data(key, data, obj_id) {
        const object_md = await rpc_client.object.read_object_md({ bucket, key, obj_id });
        return object_io.read_entire_object({ client: rpc_client, bucket, key, obj_id, object_md })
            .then(read_buf => {
                // verify the read buffer equals the written buffer
                assert.strictEqual(data.length, read_buf.length);
                for (let i = 0; i < data.length; i++) {
                    assert.strictEqual(data[i], read_buf[i], `mismatch data at pos ${i}`);
                }
            });
    }

    function verify_nodes_mapping() {
        return Promise.all([_.map(nodes_list, node => Promise.all([
            rpc_client.object.read_node_mapping({
                name: node.name,
                adminfo: true,
            }),
            rpc_client.object.read_node_mapping({
                name: `${node.os_info.hostname}#${node.host_seq}`,
                by_host: true,
                adminfo: true,
            })
        ]))]);
    }

});


mocha.describe('mocked agent_blocks_reclaimer', function() {

    mocha.it('should mark reclaimed on deleted nodes', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [{
            _id: new mongodb.ObjectId(),
            rpc_address: 'n2n://SlothTown',
            online: false,
            deleted: new Date()
        }];
        const blocks = [{
            _id: new mongodb.ObjectId(),
            node: nodes[0]._id,
            deleted: new Date()
        }];
        const reclaimer_mock =
            new ReclaimerMock(blocks, nodes, self.test.title);
        try {
            await reclaimer_mock.run_agent_blocks_reclaimer();
            assert(reclaimer_mock.blocks[0].reclaimed, 'Block was not reclaimed');
            assert(reclaimer_mock.reclaimed_blocks.length === 0, 'Reclaimer sent delete to deleted node');
        } catch (err) {
            console.error(err, err.stack);
            throw err;
        }
    });

    mocha.it('should not mark reclaimed on offline nodes', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [{
            _id: new mongodb.ObjectId(),
            rpc_address: 'n2n://SlothTown',
            online: false,
        }];
        const blocks = [{
            _id: new mongodb.ObjectId(),
            node: nodes[0]._id,
            deleted: new Date(),
            fail_to_delete: true
        }];
        const reclaimer_mock =
            new ReclaimerMock(blocks, nodes, self.test.title);
        try {
            await reclaimer_mock.run_agent_blocks_reclaimer();
            assert(!reclaimer_mock.blocks[0].reclaimed, 'Block was reclaimed');
            assert(reclaimer_mock.reclaimed_blocks.length === 1, 'Reclaimer did not try to delete on offline node');
        } catch (err) {
            console.error(err, err.stack);
            throw err;
        }
    });

    mocha.it('should mark reclaimed on non existing nodes', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [{
            _id: new mongodb.ObjectId(),
            rpc_address: 'n2n://SlothTown',
            online: true,
        }];
        const blocks = [{
            _id: new mongodb.ObjectId(),
            // Non existing node on purpose
            node: new mongodb.ObjectId(),
            deleted: new Date()
        }];
        const reclaimer_mock =
            new ReclaimerMock(blocks, nodes, self.test.title);
        try {
            await reclaimer_mock.run_agent_blocks_reclaimer();
            assert(reclaimer_mock.blocks[0].reclaimed, 'Block was not reclaimed');
            assert(reclaimer_mock.reclaimed_blocks.length === 0, 'Reclaimer sent delete to non existing node');
        } catch (err) {
            console.error(err, err.stack);
            throw err;
        }
    });

    mocha.it('should not mark reclaimed on failure to delete', async function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [{
            _id: new mongodb.ObjectId(),
            rpc_address: 'n2n://SlothTown',
            online: true,
        }];
        const blocks = [{
            _id: new mongodb.ObjectId(),
            node: nodes[0]._id,
            deleted: new Date()
        }, {
            _id: new mongodb.ObjectId(),
            node: nodes[0]._id,
            deleted: new Date(),
            fail_to_delete: true
        }];
        const reclaimer_mock =
            new ReclaimerMock(blocks, nodes, self.test.title);
        try {
            await reclaimer_mock.run_agent_blocks_reclaimer();
            assert(reclaimer_mock.blocks[0].reclaimed && !reclaimer_mock.blocks[0].fail_to_delete, 'Block was not reclaimed');
            assert(!reclaimer_mock.blocks[1].reclaimed && reclaimer_mock.blocks[1].fail_to_delete, 'Block was reclaimed on failure to delete');
            assert(reclaimer_mock.reclaimed_blocks.length === 2, 'Reclaimer did not sent delete to nodes');
        } catch (err) {
            console.error(err, err.stack);
            throw err;
        }
    });

});
