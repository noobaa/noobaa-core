/* Copyright (C) 2026 NooBaa */
'use strict';

/** @typedef {typeof import('../../../sdk/nb')} nb */

const coretest = require('../../utils/coretest/coretest');
coretest.no_setup();

const mocha = require('mocha');
const assert = require('assert');
const sinon = require('sinon');
const mongodb = require('mongodb');

const MDStore = require('../../../server/object_services/md_store').MDStore;
const nodes_client = require('../../../server/node_services/nodes_client');
const system_store = require('../../../server/system_services/system_store').get_instance();
const map_server = require('../../../server/object_services/map_server');
const { BlockDB } = require('../../../server/object_services/map_db_types');

mocha.describe('test map_server', function() {
    mocha.describe('prepare_blocks_from_db missing chunks', function() {
        const pool_id = new mongodb.ObjectId();
        const node_id = new mongodb.ObjectId();
        const system = { _id: new mongodb.ObjectId() };
        const pool = { _id: pool_id, name: 'pool1', system };
        const node = {
            _id: node_id,
            pool: 'pool1',
            rpc_address: 'n2n://test',
            node_type: 'BLOCK_STORE_FS',
        };

        let sandbox;
        let find_chunks_by_ids;
        let list_nodes_by_identity;
        let orig_data;

        mocha.beforeEach(function() {
            sandbox = sinon.createSandbox();
            find_chunks_by_ids = sandbox.stub();
            list_nodes_by_identity = sandbox.stub().resolves({ nodes: [node] });
            sandbox.stub(MDStore, 'instance').returns({ find_chunks_by_ids });
            sandbox.stub(nodes_client, 'instance').returns({ list_nodes_by_identity });
            orig_data = system_store.data;
            system_store.data = {
                get_by_id(id) {
                    return String(id) === String(pool_id) ? pool : null;
                },
                systems: [{ pools_by_name: { pool1: pool } }],
            };
        });

        mocha.afterEach(function() {
            system_store.data = orig_data;
            sandbox.restore();
        });

        mocha.it('includes blocks with no matching chunk when include_empty_blocks is true', async function() {
            find_chunks_by_ids.resolves([]);
            const block = make_block({ chunk: new mongodb.ObjectId() });

            const db_blocks = await map_server.prepare_blocks_from_db([block], true);

            assert.strictEqual(db_blocks.length, 1);
            assert.ok(db_blocks[0] instanceof BlockDB);
            assert.strictEqual(db_blocks[0].chunk, undefined);
            assert.strictEqual(db_blocks[0].frag, undefined);
            const block_md = db_blocks[0].to_block_md();
            assert.strictEqual(block_md.id, String(block._id));
            assert.strictEqual(block_md.digest_type, undefined);
            assert.strictEqual(block_md.digest_b64, undefined);
        });

        mocha.it('does not throw when block.chunk is missing', async function() {
            find_chunks_by_ids.resolves([]);
            const block = make_block({ chunk: undefined });

            const included = await map_server.prepare_blocks_from_db([block], true);
            assert.strictEqual(included.length, 1);
            assert.strictEqual(included[0].chunk, undefined);

            const skipped = await map_server.prepare_blocks_from_db([block], false);
            assert.strictEqual(skipped.length, 0);
            assert.strictEqual(list_nodes_by_identity.callCount, 1, 'skip path should not populate nodes for empty results');
        });

        mocha.it('skips missing-chunk blocks when include_empty_blocks is false', async function() {
            const frag = make_frag();
            const chunk = make_chunk(frag);
            const valid_block = make_block({ chunk: chunk._id, frag: frag._id });
            const missing_block = make_block({ chunk: new mongodb.ObjectId(), frag: frag._id });
            find_chunks_by_ids.resolves([chunk]);

            const db_blocks = await map_server.prepare_blocks_from_db([missing_block, valid_block], false);

            assert.strictEqual(db_blocks.length, 1);
            assert.ok(db_blocks.every(Boolean), 'result must not contain undefined elements');
            assert.strictEqual(String(db_blocks[0]._id), String(valid_block._id));
            assert.ok(db_blocks[0].chunk);
        });

        mocha.it('keeps both valid and missing-chunk blocks when include_empty_blocks is true', async function() {
            const frag = make_frag();
            const chunk = make_chunk(frag);
            const valid_block = make_block({ chunk: chunk._id, frag: frag._id });
            const missing_block = make_block({ chunk: new mongodb.ObjectId(), frag: frag._id });
            find_chunks_by_ids.resolves([chunk]);

            const db_blocks = await map_server.prepare_blocks_from_db([missing_block, valid_block], true);

            assert.strictEqual(db_blocks.length, 2);
            assert.ok(db_blocks.every(Boolean), 'result must not contain undefined elements');
            assert.strictEqual(db_blocks[0].chunk, undefined);
            assert.ok(db_blocks[1].chunk);
            assert.doesNotThrow(() => db_blocks[0].to_block_md());
        });

        /**
         * @param {{ chunk?: nb.ID, frag?: nb.ID }} params
         * @returns {nb.BlockSchemaDB}
         */
        function make_block({ chunk, frag } = {}) {
            return {
                _id: new mongodb.ObjectId(),
                node: node_id,
                frag: frag || new mongodb.ObjectId(),
                chunk,
                system: system._id,
                bucket: new mongodb.ObjectId(),
                pool: pool_id,
                size: 20,
            };
        }

        /**
         * @returns {nb.FragSchemaDB}
         */
        function make_frag() {
            return {
                _id: new mongodb.ObjectId(),
                digest: Buffer.from('digest'),
            };
        }

        /**
         * @param {nb.FragSchemaDB} frag
         * @returns {nb.ChunkSchemaDB}
         */
        function make_chunk(frag) {
            return {
                _id: new mongodb.ObjectId(),
                system: system._id,
                bucket: new mongodb.ObjectId(),
                tier: new mongodb.ObjectId(),
                tier_lru: new Date(),
                chunk_config: new mongodb.ObjectId(),
                size: 10,
                compress_size: 10,
                frag_size: 10,
                frags: [frag],
            };
        }
    });

    mocha.describe('BlockDB.to_block_md missing chunk', function() {

        mocha.it('does not throw when chunk and frag are undefined', function() {
            const block = new BlockDB({
                _id: new mongodb.ObjectId(),
                node: new mongodb.ObjectId(),
                pool: new mongodb.ObjectId(),
                size: 10,
            }, undefined, undefined);
            const md = block.to_block_md();
            assert.strictEqual(md.id, String(block._id));
            assert.strictEqual(md.digest_type, undefined);
            assert.strictEqual(md.digest_b64, undefined);
        });

    });
});
