/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const AgentBlocksVerifier = require('../../server/bg_services/agent_blocks_verifier').AgentBlocksVerifier;
const db_client = require('../../util/db_client');
const schema_utils = require('../../util/schema_utils');
const mongodb = require('mongodb');
const config = require('../../../config');
const { ChunkDB, BlockDB } = require('../../server/object_services/map_db_types');

class VerifierMock extends AgentBlocksVerifier {
    /**
     *
     * @param {nb.BlockSchemaDB[]} blocks
     * @param {nb.NodeAPI[]} nodes
     * @param {nb.ChunkSchemaDB[]} chunks
     * @param {nb.Pool[]} pools
     * @param {string} test_suffix
     */
    constructor(blocks = [], nodes = [], chunks = [], pools = [], test_suffix = '') {
        super(`VerifierMock-${test_suffix}`);
        console.log('VerifierMock INIT', test_suffix, blocks, nodes, chunks);
        this.blocks = blocks;
        this.nodes = nodes;
        this.chunks = chunks;
        this.pools = pools;
        /** @type {nb.BlockSchemaDB[]} */
        this.verified_blocks = [];
    }

    /**
     *
     * @param {nb.ID} marker
     * @param {number} limit
     * @param {boolean} deleted_only
     * @returns {Promise<nb.BlockSchemaDB[]>}
     */
    async iterate_all_blocks(marker, limit, deleted_only) {
        assert(marker === undefined || marker === null || this.is_valid_md_id(marker),
            'Marker not null or valid ObjectId');
        assert(limit === config.AGENT_BLOCKS_VERIFIER_BATCH_SIZE, 'Wrong verifier config limit');
        assert(deleted_only === false, 'Verifier should check only non deleted and non reclaimed blocks');
        // TODO: Pay attention to marker and limit
        return this.blocks.filter(block => (deleted_only ? block.deleted : !block.deleted));
    }

    is_valid_md_id(id_str) {
        return schema_utils.is_object_id(id_str);
    }

    /**
     *
     * @param {nb.BlockSchemaDB[]} blocks
     * @returns {Promise<nb.Block[]>}
     */
    async populate_and_prepare_for_blocks(blocks) {
        const docs = blocks;
        const doc_path = 'node';
        const docs_list = docs && !_.isArray(docs) ? [docs] : docs;
        const node_ids = db_client.instance().uniq_ids(docs_list, doc_path);
        const nodes = this.nodes.filter(node =>
            _.includes(node_ids.map(node_id => String(node_id)), String(node._id)));
        const chunks_idmap = _.keyBy(this.chunks, '_id');
        const nodes_idmap = _.keyBy(nodes, '_id');
        const pools_name = _.keyBy(this.pools, 'name');
        const db_blocks = blocks.map(block => {
            const chunk_id = _.get(block, 'chunk');
            const chunk = new ChunkDB(chunks_idmap[chunk_id.toHexString()]);
            const frag = chunk.frags[0];
            const db_block = new BlockDB(block, frag, chunk);
            const id = _.get(block, doc_path);
            const node = nodes_idmap[String(id)];
            if (node) {
                db_client.instance().fix_id_type(node);
                db_block.set_node(node, pools_name[node.pool]);
                db_block.set_digest_type('sha1');
            } else {
                console.warn('populate_nodes: missing node for id',
                    id, 'DOC', block, 'IDMAP', _.keys(nodes_idmap));
            }
            return db_block;
        });
        try {
            return db_blocks;
        } catch (err) {
            console.error('populate_nodes: ERROR', err.stack);
            throw err;
        }
    }

    verify_blocks(rpc_params, target_params) {
        assert(target_params &&
            _.difference(Object.keys(target_params), ['address', 'timeout']).length === 0,
            'Verifier should only send to address with timeout');
        assert(rpc_params &&
            _.difference(Object.keys(rpc_params), ['verify_blocks']).length === 0,
            'Verifier should only have verify_blocks in parameters');

        const block_ids = rpc_params.verify_blocks.map(block => {
            assert(this.is_valid_md_id(block.id), 'Block id not valid ObjectId');
            assert(block.address, 'Block id without node address');
            assert(block.digest_type, 'Block without digest_type');
            assert(block.digest_b64, 'Block without digest_b64');
            return block.id;
        });
        this.verified_blocks = _.concat(this.verified_blocks, block_ids);
        console.log('verify_blocks', block_ids, 'node', target_params.address);
        return P.resolve();
    }

}


mocha.describe('mocked agent_blocks_verifier', function() {
    const tier_id = new mongodb.ObjectId();
    const bucket_id = new mongodb.ObjectId();
    const system_id = new mongodb.ObjectId();

    mocha.it('should verify blocks on nodes', function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [make_node('bla2', false)];
        const chunk_coder_configs = [{
            _id: new mongodb.ObjectId(),
            chunk_coder_config: {
                frag_digest_type: 'sloth_type'
            }
        }];
        const chunks = [make_schema_chunk(chunk_coder_configs[0]._id, [make_schema_frag()])];
        const pools = [make_schema_pool('pool1')];
        const blocks = [make_schema_block(chunks[0].frags[0]._id, chunks[0]._id, nodes[0]._id, pools[0]._id)];
        const verifier_mock = new VerifierMock(blocks, nodes, chunks, pools);
        return P.resolve()
            .then(() => verifier_mock.run_agent_blocks_verifier())
            .then(() => {
                assert(verifier_mock.verified_blocks.length === 1, self.test.title);
            })
            .catch(err => {
                console.error(err, err.stack);
                throw err;
            });
    });

    mocha.it('should not verify blocks on offline nodes', function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [make_node('bla1', true)];
        const chunk_coder_configs = [{
            _id: new mongodb.ObjectId(),
            chunk_coder_config: {
                frag_digest_type: 'sloth_type'
            }
        }];
        const chunks = [make_schema_chunk(chunk_coder_configs[0]._id, [make_schema_frag()])];
        const pools = [make_schema_pool('pool1')];
        const blocks = [make_schema_block(chunks[0].frags[0]._id, chunks[0]._id, nodes[0]._id, pools[0]._id)];

        const verifier_mock = new VerifierMock(blocks, nodes, chunks, pools);
        return P.resolve()
            .then(() => verifier_mock.run_agent_blocks_verifier())
            .then(() => {
                assert(verifier_mock.verified_blocks.length === 0, self.test.title);
            })
            .catch(err => {
                console.error(err, err.stack);
                throw err;
            });
    });

    mocha.it('should not verify blocks on non existing nodes', function() {
        const self = this; // eslint-disable-line no-invalid-this
        // const nodes = [make_node('node1')];
        const chunk_coder_configs = [{
            _id: new mongodb.ObjectId(),
            system: system_id,
            chunk_coder_config: {
                frag_digest_type: 'sloth_type'
            }
        }];
        const chunks = [make_schema_chunk(chunk_coder_configs[0]._id, [make_schema_frag()])];
        const pools = [make_schema_pool('pool1')];
        const blocks = [make_schema_block(chunks[0].frags[0]._id, chunks[0]._id, new mongodb.ObjectId(), pools[0]._id)];

        const verifier_mock = new VerifierMock(blocks, [], chunks, pools);
        return P.resolve()
            .then(() => verifier_mock.run_agent_blocks_verifier())
            .then(() => {
                assert(verifier_mock.verified_blocks.length === 0, self.test.title);
            })
            .catch(err => {
                console.error(err, err.stack);
                throw err;
            });
    });

    /**
     *
     * @param {nb.ID} frag_id
     * @param {nb.ID} chunk_id
     * @returns {nb.BlockSchemaDB}
     */
    function make_schema_block(frag_id, chunk_id, node_id, pool_id) {
        return {
            _id: new mongodb.ObjectId(),
            node: node_id,
            frag: frag_id,
            chunk: chunk_id,
            system: system_id,
            bucket: bucket_id,
            pool: pool_id,
            size: 20
        };
    }

    /**
     *
     * @returns {nb.FragSchemaDB}
     */
    function make_schema_frag() {
        return {
            _id: new mongodb.ObjectId(),
            digest: Buffer.from('bla')
        };
    }

    /**
     *
     * @returns {nb.ChunkSchemaDB}
     */
    function make_schema_chunk(cc_id, frags) {
        return {
            _id: new mongodb.ObjectId(),
            system: system_id,
            bucket: bucket_id,
            tier: tier_id,
            tier_lru: new Date(),
            chunk_config: cc_id,
            size: 10,
            compress_size: 10,
            frag_size: 10,
            dedup_key: undefined,
            digest: undefined,
            cipher_key: undefined,
            cipher_iv: undefined,
            cipher_auth_tag: undefined,
            frags
        };
    }

    /**
     *
     * @param {string} node_name
     * @param {boolean} offline
     * @returns {nb.NodeAPI}
     */
    function make_node(node_name, offline) {
        return {
            _id: new mongodb.ObjectId(),
            name: node_name,
            pool: 'pool1',
            node_type: 'BLOCK_STORE_FS',
            rpc_address: 'n2n://SlothTown',
            ip: '1.1.1.1',
            online: !offline,
            writable: true,
            readable: true,
            is_cloud_node: false,
            is_mongo_node: false,
            host_id: 'bla',
            host_seq: 'bla',
            heartbeat: 12,
            os_info: {
                hostname: node_name,
            },
            drive: {
                mount: 'a:/',
            },
        };
    }

    /**
     *
     * @param {string} name
     * @returns {nb.Pool}
     */
    function make_schema_pool(name) {
        return {
            _id: new mongodb.ObjectId(),
            name: name,
            system: undefined,
            resource_type: 'HOSTS',
            pool_node_type: 'BLOCK_STORE_S3'
        };
    }

});
