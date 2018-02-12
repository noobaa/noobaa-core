/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const mongo_utils = require('../../util/mongo_utils');
const map_deleter = require('../object_services/map_deleter');

class AgentBlocksReclaimer {

    constructor(name) {
        this.name = name;
    }

    run_batch() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('AGENT_BLOCKS_RECLAIMER: system_store did not finish initial load');
            return;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return;

        return this.run_agent_blocks_reclaimer();
    }

    run_agent_blocks_reclaimer() {
        if (!this.marker) {
            dbg.log0('AGENT_BLOCKS_RECLAIMER:', 'BEGIN');
        }

        return this.iterate_all_blocks(
                this.marker,
                config.AGENT_BLOCKS_RECLAIMER_BATCH_SIZE,
                true /* deleted_only */
            )
            .then(blocks => {
                this.marker = blocks.length ? blocks[blocks.length - 1]._id : null;
                return this.populate_agent_blocks_reclaimer_blocks(blocks);
            })
            .then(blocks_to_reclaim => {
                if (!blocks_to_reclaim || !blocks_to_reclaim.length) return;
                dbg.log0('AGENT_BLOCKS_RECLAIMER:',
                    'DELETING:', blocks_to_reclaim);
                return this.delete_blocks_from_nodes(blocks_to_reclaim);
            })
            .then(() => {
                // return the delay before next batch
                if (this.marker) {
                    dbg.log0('AGENT_BLOCKS_RECLAIMER:', 'CONTINUE', this.marker, this.marker.getTimestamp());
                    return config.AGENT_BLOCKS_RECLAIMER_BATCH_DELAY;
                }
                dbg.log0('AGENT_BLOCKS_RECLAIMER:', 'END');
                return config.AGENT_BLOCKS_RECLAIMER_RESTART_DELAY;
            })
            .catch(err => {
                // return the delay before next batch
                dbg.error('AGENT_BLOCKS_RECLAIMER:', 'ERROR', err, err.stack);
                return config.AGENT_BLOCKS_RECLAIMER_ERROR_DELAY;
            });
    }

    populate_agent_blocks_reclaimer_blocks(blocks) {

        if (!blocks || !blocks.length) return;

        let blocks_with_nodes;
        return this.populate_nodes_for_blocks(blocks)
            .then(res => {
                blocks_with_nodes = res;
                const blocks_with_unpopulated_nodes = blocks_with_nodes.filter(block =>
                    !(block.node && block.node.rpc_address));
                const block_ids = mongo_utils.uniq_ids(blocks_with_unpopulated_nodes, '_id');
                return block_ids.length && this.update_blocks_by_ids(block_ids, { reclaimed: new Date() });
            })
            .then(() => {
                const blocks_with_alive_nodes = blocks_with_nodes.filter(block =>
                    block.node && block.node.rpc_address && block.node.online);
                return blocks_with_alive_nodes;
            });
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
    delete_blocks_from_nodes(...args) {
        return map_deleter.delete_blocks_from_nodes(...args);
    }

    /**
     * @override in unit tests for decoupling dependencies
     */
    update_blocks_by_ids(...args) {
        return MDStore.instance().update_blocks_by_ids(...args);
    }

    /**
     * @override in unit tests for decoupling dependencies
     */
    populate_nodes_for_blocks(...args) {
        return MDStore.instance().populate_nodes_for_blocks(...args);
    }

}

// EXPORTS
exports.AgentBlocksReclaimer = AgentBlocksReclaimer;
