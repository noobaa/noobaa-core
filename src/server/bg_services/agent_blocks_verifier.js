/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const server_rpc = require('../server_rpc');
const mapper = require('../object_services/mapper');

class AgentBlocksVerifier {

    constructor(name) {
        this.name = name;
    }

    run_batch() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('AGENT_BLOCKS_VERIFIER: system_store did not finish initial load');
            return;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return;

        return this.run_agent_blocks_verifier();
    }

    run_agent_blocks_verifier() {
        if (!this.marker) {
            dbg.log0('AGENT_BLOCKS_VERIFIER:', 'BEGIN');
        }

        return this.iterate_all_blocks(
                this.marker,
                config.AGENT_BLOCKS_VERIFIER_BATCH_SIZE,
                false /* deleted_only */
            )
            .then(blocks => {
                this.marker = blocks.length ? blocks[blocks.length - 1].id : null;
                return this.populate_agent_blocks_verifier_blocks(blocks);
            })
            .then(blocks_to_verify => {
                if (!blocks_to_verify || !blocks_to_verify.length) return;
                if (dbg.should_log(2)) {
                    for (let i = 0; i < blocks_to_verify.length; i += 20) {
                        dbg.log2('AGENT_BLOCKS_VERIFIER:',
                            'VERIFYING:', blocks_to_verify.slice(i, i + 20));
                    }
                }
                return this.verify_blocks_on_agents(blocks_to_verify);
            })
            .then(() => {
                // return the delay before next batch
                if (this.marker) {
                    dbg.log0('AGENT_BLOCKS_VERIFIER:', 'CONTINUE', this.marker, this.marker.getTimestamp());
                    return config.AGENT_BLOCKS_VERIFIER_BATCH_DELAY;
                }
                dbg.log0('AGENT_BLOCKS_VERIFIER:', 'END');
                return config.AGENT_BLOCKS_VERIFIER_RESTART_DELAY;
            })
            .catch(err => {
                // return the delay before next batch
                dbg.error('AGENT_BLOCKS_VERIFIER:', 'ERROR', err, err.stack);
                return config.AGENT_BLOCKS_VERIFIER_ERROR_DELAY;
            });
    }

    populate_agent_blocks_verifier_blocks(blocks) {
        if (!blocks || !blocks.length) return;

        return this.populate_nodes_for_blocks(blocks)
            .then(blocks_with_nodes => {
                this.populate_pools_for_blocks(blocks_with_nodes);
                const blocks_with_alive_nodes = blocks_with_nodes.filter(block =>
                    block.node && block.node.rpc_address && block.node.online);
                if (!blocks_with_alive_nodes || !blocks_with_alive_nodes.length) return;
                return this.populate_chunks(blocks_with_alive_nodes, 'chunk', { frags: 1, chunk_config: 1 });
            })
            .then(populated_blocks => {
                if (!populated_blocks || !populated_blocks.length) return;
                return populated_blocks.map(block => {
                    const chunk_config = this.get_by_id(block.chunk.chunk_config);
                    if (!chunk_config) {
                        dbg.warn('populate_agent_blocks_verifier_blocks: Chunk config not found', block.chunk.chunk_config);
                    }
                    block.chunk.chunk_coder_config = chunk_config && chunk_config.chunk_coder_config;
                    const frag = block.chunk.frags.find(frag_rec => String(frag_rec._id) === String(block.frag));
                    return mapper.get_block_md(block.chunk, frag, block);
                });
            });
    }

    verify_blocks_on_agents(blocks_to_verify) {
        return P.resolve()
            .then(() => {
                const verify_blocks_group_by_nodes = _.groupBy(blocks_to_verify, 'address');
                return P.map(Object.keys(verify_blocks_group_by_nodes), address => {
                    const verify_blocks = verify_blocks_group_by_nodes[address];
                    return this.verify_blocks({
                            verify_blocks
                        }, {
                            address: address,
                            timeout: config.AGENT_BLOCKS_RECLAIMER_TIMEOUT,
                        })
                        .catch(err => {
                            dbg.warn('AGENT_BLOCKS_VERIFIER:',
                                'verify_blocks FAILED',
                                'ADDR:', address,
                                'VERIFY_BLOCKS:', verify_blocks,
                                'ERROR:', err);
                            // TODO: Should perform further action
                            // throw err;
                        });
                });
            })
            .return();
    }


    /**
     * @override in unit tests for decoupling dependencies
     */
    iterate_all_blocks(...args) {
        return MDStore.instance().iterate_all_blocks(...args);
    }

    /**
     * @override in unit tests for decoupling dependencies
     */
    populate_nodes_for_blocks(...args) {
        return MDStore.instance().populate_nodes_for_blocks(...args);
    }

    /**
     * @override in unit tests for decoupling dependencies
     */
    populate_chunks(...args) {
        return MDStore.instance().populate_chunks(...args);
    }

    /**
     * @override in unit tests for decoupling dependencies
     */
    get_by_id(...args) {
        return system_store.data.get_by_id(...args);
    }

    /**
     * @override in unit tests for decoupling dependencies
     */
    verify_blocks(...args) {
        return server_rpc.client.block_store.verify_blocks(...args);
    }

    /**
     * @override in unit tests for decoupling dependencies
     */
    populate_pools_for_blocks(...args) {
        return system_utils.populate_pools_for_blocks(...args);
    }

}

// EXPORTS
exports.AgentBlocksVerifier = AgentBlocksVerifier;
