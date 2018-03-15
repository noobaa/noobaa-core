/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const AgentBlocksVerifier = require('../../server/bg_services/agent_blocks_verifier').AgentBlocksVerifier;
const mongo_utils = require('../../util/mongo_utils');
const mongodb = require('mongodb');
const config = require('../../../config');

class VerifierMock extends AgentBlocksVerifier {

    constructor(blocks = [], nodes = [], chunks = [], chunk_coder_configs = [], test_suffix = '') {
        super(`VerifierMock-${test_suffix}`);
        console.log('VerifierMock INIT', test_suffix, blocks, nodes, chunks, chunk_coder_configs);
        this.blocks = blocks;
        this.nodes = nodes;
        this.chunks = chunks;
        this.chunk_coder_configs = chunk_coder_configs;
        this.verified_blocks = [];
    }

    iterate_all_blocks(marker, limit, deleted_only) {
        assert(marker === undefined || marker === null || this.is_valid_md_id(marker),
            'Marker not null or valid ObjectId');
        assert(limit === config.AGENT_BLOCKS_VERIFIER_BATCH_SIZE, 'Wrong verifier config limit');
        assert(deleted_only === false, 'Verifier should check only non deleted and non reclaimed blocks');
        // TODO: Pay attention to marker and limit
        return P.resolve(this.blocks.filter(block => (deleted_only ? block.deleted : !block.deleted)));
    }

    is_valid_md_id(id_str) {
        return mongodb.ObjectId.isValid(id_str);
    }

    get_by_id(id_str) {
        return this.chunk_coder_configs.find(coder => String(coder._id) === String(id_str));
    }

    populate_chunks(docs, doc_path, fields) {
        assert(doc_path === 'chunk', 'Verifier should only send populate to chunk property of block');
        assert(fields &&
            _.difference(Object.keys(fields), ['frags', 'chunk_config']).length === 0,
            'Verifier should only send fields with frags and chunk_config');

        const docs_list = docs && !_.isArray(docs) ? [docs] : docs;
        const ids = mongo_utils.uniq_ids(docs_list, doc_path);
        if (!ids.length) return P.resolve(docs);

        return P.resolve()
            .then(() => this.chunks.filter(chunk =>
                _.includes(ids.map(chunk_id => String(chunk_id)), String(chunk._id))))
            .then(chunks => {
                const idmap = _.keyBy(chunks, '_id');
                _.each(docs_list, doc => {
                    const id = _.get(doc, doc_path);
                    const chunk = idmap[String(id)];
                    if (chunk) {
                        mongo_utils.fix_id_type(chunk);
                        _.set(doc, doc_path, chunk);
                    } else {
                        console.warn('populate_chunks: missing chunk for id',
                            id, 'DOC', doc, 'IDMAP', _.keys(idmap));
                    }
                });
                return docs;
            })
            .catch(err => {
                console.error('populate_chunks: ERROR', err.stack);
                throw err;
            });
    }

    populate_pools_for_blocks(blocks) {
        // We already create the pools in block's nodes as mock objects
    }

    populate_nodes_for_blocks(blocks) {
        const docs = blocks;
        const doc_path = 'node';
        const docs_list = docs && !_.isArray(docs) ? [docs] : docs;
        const ids = mongo_utils.uniq_ids(docs_list, doc_path);
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
                        mongo_utils.fix_id_type(node);
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

    mocha.it('should verify blocks on nodes', function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [{
            _id: new mongodb.ObjectId(),
            rpc_address: 'n2n://SlothTown',
            online: true,
            pool: {
                _id: new mongodb.ObjectId()
            }
        }];
        const chunk_coder_configs = [{
            _id: new mongodb.ObjectId(),
            chunk_coder_config: {
                frag_digest_type: 'sloth_type'
            }
        }];
        const chunks = [{
            _id: new mongodb.ObjectId(),
            frags: [{
                _id: new mongodb.ObjectId(),
                digest: 'sloth_digest'
            }],
            chunk_config: chunk_coder_configs[0]._id
        }];
        const blocks = [{
            _id: new mongodb.ObjectId(),
            node: nodes[0]._id,
            frag: chunks[0].frags[0]._id,
            chunk: chunks[0]._id,
            node_pool_id: new mongodb.ObjectId()
        }];
        const verifier_mock = new VerifierMock(blocks, nodes, chunks, chunk_coder_configs);
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

    mocha.it('should not verify blocks on deleted nodes', function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [{
            _id: new mongodb.ObjectId(),
            rpc_address: 'n2n://SlothTown',
            online: false,
            pool: {
                _id: new mongodb.ObjectId()
            },
            deleted: new Date()
        }];
        const chunk_coder_configs = [{
            _id: new mongodb.ObjectId(),
            chunk_coder_config: {
                frag_digest_type: 'sloth_type'
            }
        }];
        const chunks = [{
            _id: new mongodb.ObjectId(),
            frags: [{
                _id: new mongodb.ObjectId(),
                digest: 'sloth_digest'
            }],
            chunk_config: chunk_coder_configs[0]._id
        }];
        const blocks = [{
            _id: new mongodb.ObjectId(),
            node: nodes[0]._id,
            frag: chunks[0].frags[0]._id,
            chunk: chunks[0]._id
        }];
        const verifier_mock = new VerifierMock(blocks, nodes, chunks, chunk_coder_configs);
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

    mocha.it('should not verify blocks on offline nodes', function() {
        const self = this; // eslint-disable-line no-invalid-this
        const nodes = [{
            _id: new mongodb.ObjectId(),
            rpc_address: 'n2n://SlothTown',
            online: false,
            pool: {
                _id: new mongodb.ObjectId()
            }
        }];
        const chunk_coder_configs = [{
            _id: new mongodb.ObjectId(),
            chunk_coder_config: {
                frag_digest_type: 'sloth_type'
            }
        }];
        const chunks = [{
            _id: new mongodb.ObjectId(),
            frags: [{
                _id: new mongodb.ObjectId(),
                digest: 'sloth_digest'
            }],
            chunk_config: chunk_coder_configs[0]._id
        }];
        const blocks = [{
            _id: new mongodb.ObjectId(),
            node: nodes[0]._id,
            frag: chunks[0].frags[0]._id,
            chunk: chunks[0]._id,
            node_pool_id: new mongodb.ObjectId()
        }];
        const verifier_mock = new VerifierMock(blocks, nodes, chunks, chunk_coder_configs);
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
        const nodes = [{
            _id: new mongodb.ObjectId(),
            rpc_address: 'n2n://SlothTown',
            online: true,
            pool: {
                _id: new mongodb.ObjectId()
            }
        }];
        const chunk_coder_configs = [{
            _id: new mongodb.ObjectId(),
            chunk_coder_config: {
                frag_digest_type: 'sloth_type'
            }
        }];
        const chunks = [{
            _id: new mongodb.ObjectId(),
            frags: [{
                _id: new mongodb.ObjectId(),
                digest: 'sloth_digest'
            }],
            chunk_config: chunk_coder_configs[0]._id
        }];
        const blocks = [{
            _id: new mongodb.ObjectId(),
            node: new mongodb.ObjectId(),
            frag: chunks[0].frags[0]._id,
            chunk: chunks[0]._id,
            node_pool_id: new mongodb.ObjectId()
        }];
        const verifier_mock = new VerifierMock(blocks, nodes, chunks, chunk_coder_configs);
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

});
