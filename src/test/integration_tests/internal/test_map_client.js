/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../../sdk/nb')} nb */

// setup coretest first to prepare the env
const coretest = require('../../utils/coretest/coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');

const { MapClient } = require('../../../sdk/map_client');
const system_store = require('../../../server/system_services/system_store').get_instance();
const db_client = require('../../../util/db_client');
const { ChunkAPI } = require('../../../sdk/map_api_types');

/* eslint max-lines-per-function: ["error", 600]*/
coretest.describe_mapper_test_case({
    name: 'map_client',
    bucket_name_prefix: 'test-map-client',
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
    if (data_placement !== 'SPREAD' || num_pools !== 1 || total_blocks !== 1) return;

    const { SYSTEM } = coretest;

    /** @type {nb.System} */
    let system;
    /** @type {nb.Bucket} */
    let bucket;

    mocha.before(async function() {
        await system_store.load();
        system = system_store.data.systems_by_name[SYSTEM];
        bucket = system.buckets_by_name[bucket_name];
    });

    // COMMENTED OUT AS IT FAILS FOR NOW
    // mocha.it('works ok', async function() {
    //     const chunk = new ChunkAPI({
    //         bucket_id: String(bucket._id),
    //         tier_id: String(bucket.tiering.tiers[0].tier._id),
    //         chunk_coder_config: { replicas: 3 },
    //         size: 1,
    //         compress_size: 1,
    //         frag_size: 1,
    //         // digest_b64: '',
    //         // cipher_key_b64: '',
    //         // cipher_iv_b64: '',
    //         // cipher_auth_tag_b64: '',
    //         frags: [{
    //             data_index: 1,
    //             blocks: [{
    //                 block_md: {
    //                     id: db_client.instance().new_object_id(),
    //                     node: nodes[0]._id,
    //                     pool: system.pools_by_name[nodes[0].pool]._id,
    //                 }
    //             }]
    //         }],
    //         parts: []
    //     }, system_store);
    //     const mc = new MapClient({
    //         chunks: [chunk],
    //         rpc_client,
    //     });
    //     await mc.run();
    // });


    /*
    mocha.describe('select_tier_for_write', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            return map_writer.select_tier_for_write(bucket, obj)
                .then(tier => {
                    assert.strictEqual(tier, bucket.tiering.tiers[0].tier);
                });
        });
    });

    mocha.describe('allocate_object_parts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            const parts = [{
                start: 0,
                end: 100,
                chunk: {
                    chunk_coder_config,
                    size: 100,
                    frag_size: 100,
                    digest_b64: Buffer.from('abcdefg').toString('base64'),
                    frags: _.concat(
                        _.times(data_frags, data_index => ({
                            data_index,
                        })),
                        _.times(parity_frags, parity_index => ({
                            parity_index,
                        }))
                    )
                }
            }];
            return map_writer.allocate_object_parts(bucket, obj, parts)
                .then(res => {
                    console.log('allocate_object_parts =>>>>', util.inspect(res, true, null, true));
                    assert.strictEqual(res.parts.length, 1);
                    const part = res.parts[0];
                    const frag = part.chunk.frags[0];
                    assert.strictEqual(frag.blocks.length, replicas);
                    assert(_.every(frag.blocks,
                        b => b.block_md && b.block_md.id && b.block_md.address && b.block_md.node
                    ));
                });
        });
    });

    mocha.describe('finalize_object_parts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            const parts = [{
                start: 0,
                end: 100,
                chunk: {
                    chunk_coder_config: bucket.tiering.tiers[0].tier.chunk_config.chunk_coder_config,
                    tier: bucket.tiering.tiers[0].tier.name,
                    size: 100,
                    frag_size: 100,
                    frags: _.concat(
                        _.times(data_frags, data_index => ({
                            data_index,
                            blocks: _.times(replicas, () => ({
                                block_md: {
                                    id: MDStore.instance().make_md_id(),
                                    node: MDStore.instance().make_md_id(),
                                    pool: MDStore.instance().make_md_id(),
                                }
                            }))
                        })),
                        _.times(parity_frags, parity_index => ({
                            parity_index,
                            blocks: _.times(replicas, () => ({
                                block_md: {
                                    id: MDStore.instance().make_md_id(),
                                    node: MDStore.instance().make_md_id(),
                                    pool: MDStore.instance().make_md_id(),
                                }
                            }))
                        }))
                    )
                }
            }];
            return map_writer.finalize_object_parts(bucket, obj, parts);
        });
    });

    mocha.describe('complete_object_parts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            return map_writer.complete_object_parts(obj);
        });
    });

    mocha.describe('complete_object_multiparts', function() {
        mocha.it('works', function() {
            const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
            const obj = {
                _id: MDStore.instance().make_md_id(),
                system: bucket.system._id,
            };
            const multiparts_req = [];
            return map_writer.complete_object_parts(obj, multiparts_req);
        });
    });

    */

    mocha.describe('move blocks to storage class', function() {
        mocha.it('should not attempt movement when move_to_tier is not set', async function() {
            // mock rpc_client
            const mock_rpc_client = {
                block_store: {
                    move_blocks_to_storage_class: () => {
                        throw new Error('should not be called');
                    }
                }
            };

            // @ts-ignore
            const mc = new MapClient({
                chunks: generate_mock_chunks(1),
                rpc_client: mock_rpc_client,
            });

            await mc.move_blocks_to_storage_class();
        });

        mocha.it('should not attempt movement when current_tiers is not set', async function() {
            let movement_attempted = false;

            // mock rpc_client
            const mock_rpc_client = {
                block_store: {
                    move_blocks_to_storage_class: () => {
                        movement_attempted = true;

                        return ["mocked_response"];
                    }
                }
            };

            const temporary_tier = generate_mock_tier();

            // @ts-ignore
            const mc = new MapClient({
                chunks: generate_mock_chunks(1),
                rpc_client: mock_rpc_client,
                move_to_tier: temporary_tier
            });

            await mc.move_blocks_to_storage_class();

            assert.strictEqual(movement_attempted, false);
        });

        mocha.it('should throw error when attempt movement when len(current_tiers) does not match len(chunks)', async function() {
            // mock rpc_client
            const mock_rpc_client = {
                block_store: {
                    move_blocks_to_storage_class: () => ["mocked_response"]
                }
            };

            const temporary_tier = generate_mock_tier();

            // @ts-ignore
            const mc = new MapClient({
                chunks: generate_mock_chunks(2),
                rpc_client: mock_rpc_client,
                move_to_tier: temporary_tier,
                current_tiers: [bucket.tiering.tiers[0].tier]
            });

            let errored = false;

            try {
                await mc.move_blocks_to_storage_class();
            } catch (err) {
                errored = true;
            }


            assert.strictEqual(errored, true);
        });

        mocha.it('should not attempt movement when storage classes are same', async function() {
            let movement_attempted = false;

            // mock rpc_client
            const mock_rpc_client = {
                block_store: {
                    move_blocks_to_storage_class: () => {
                        movement_attempted = true;

                        return ["mocked_response"];
                    }
                }
            };

            // @ts-ignore
            const mc = new MapClient({
                chunks: generate_mock_chunks(1),
                rpc_client: mock_rpc_client,
                move_to_tier: bucket.tiering.tiers[0].tier,
                current_tiers: [bucket.tiering.tiers[0].tier]
            });

            await mc.move_blocks_to_storage_class();

            assert.strictEqual(movement_attempted, false);
        });

        mocha.it('should not attempt movement when storage pools differ', async function() {
            let movement_attempted = false;

            // mock rpc_client
            const mock_rpc_client = {
                block_store: {
                    move_blocks_to_storage_class: () => {
                        movement_attempted = true;

                        return ["mocked_response"];
                    }
                }
            };

            const temporary_tier = generate_mock_tier();

            // @ts-ignore
            const mc = new MapClient({
                chunks: generate_mock_chunks(1),
                rpc_client: mock_rpc_client,
                move_to_tier: temporary_tier,
                current_tiers: [bucket.tiering.tiers[0].tier]
            });

            await mc.move_blocks_to_storage_class();

            assert.strictEqual(movement_attempted, false);
        });

        mocha.it('should attempt movement', async function() {
            let movement_attempted = false;
            let movement_block_ids = [];
            let movement_storage_class = '';
            let movement_address = '';

            // mock rpc_client
            const mock_rpc_client = {
                block_store: {
                    move_blocks_to_storage_class: ({ block_ids, storage_class }, { address }) => {
                        movement_attempted = true;
                        movement_block_ids = block_ids;
                        movement_storage_class = storage_class;
                        movement_address = address;

                        return ["mocked_response"];
                    }
                }
            };

            const temporary_tier = generate_mock_tier({
                storage_class: 'GLACIER_IR',
                mirrors: [
                    {
                        spread_pools: bucket.tiering.tiers[0].tier.mirrors[0].spread_pools,
                    }
                ]
            });

            const chunks = generate_mock_chunks(1);

            // @ts-ignore
            const mc = new MapClient({
                chunks,
                rpc_client: mock_rpc_client,
                move_to_tier: temporary_tier,
                current_tiers: [bucket.tiering.tiers[0].tier]
            });

            await mc.move_blocks_to_storage_class();

            assert.strictEqual(movement_attempted, true);
            assert.strictEqual(movement_block_ids.length, 1);
            assert.strictEqual(movement_block_ids[0], String(chunks[0].frags[0].blocks[0].block_md.id));
            assert.strictEqual(movement_storage_class, temporary_tier.storage_class);
            assert.strictEqual(movement_address, 'fcall://mocked_address');
        });
    });


    function generate_mock_chunks(count) {
        return Array(count).fill(
          new ChunkAPI(
            {
              bucket_id: String(bucket._id),
              tier_id: String(bucket.tiering.tiers[0].tier._id),
              chunk_coder_config: { replicas: 1 },
              size: 1,
              compress_size: 1,
              frag_size: 1,
              frags: [
                {
                  data_index: 1,
                  blocks: [
                    {
                      block_md: {
                        id: db_client.instance().new_object_id(),
                        pool: Object.values(system.pools_by_name)[0]._id,
                        address: 'fcall://mocked_address',
                      },
                    },
                  ],
                },
              ],
              parts: [],
            },
            system_store
          )
        );
    }

    /**
     * 
     * @param {Record<any, any>} overrides 
     * @returns {nb.Tier}
     */
    function generate_mock_tier(overrides = {}) {
        /** @type {nb.ChunkCoderConfig} */
        const chunk_config = {
            replicas: 1
        };

        const tier = {
            _id: db_client.instance().new_object_id(),
            name: 'mocked_tier',
            system: system,
            data_placement: 'MIRROR',
            chunk_config: {
                _id: db_client.instance().new_object_id(),
                system: system,
                chunk_coder_config: chunk_config
            },
            mirrors: [
                {
                    spread_pools: [
                        {
                            _id: db_client.instance().new_object_id(),
                            name: 'mocked_pool',
                        }
                    ]
                }
            ]
        };

        Object.keys(overrides).forEach(key => {
            _.set(tier, key, overrides[key]);
        });

        return tier;
    }
});
