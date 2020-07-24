/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const db_client = require('../../util/db_client');
const map_deleter = require('../object_services/map_deleter');
const map_server = require('../object_services/map_server');

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

    async run_agent_blocks_reclaimer() {
        if (!this.marker) {
            dbg.log0('AGENT_BLOCKS_RECLAIMER:', 'BEGIN');
        }

        try {
            const blocks = await this.iterate_all_blocks(
                this.marker,
                config.AGENT_BLOCKS_RECLAIMER_BATCH_SIZE,
                true /* deleted_only */
            );
            this.marker = blocks.length ? blocks[blocks.length - 1]._id : null;
            const blocks_to_reclaim = await this.populate_agent_blocks_reclaimer_blocks(blocks);
            if (!blocks_to_reclaim || !blocks_to_reclaim.length) return;
            dbg.log0('AGENT_BLOCKS_RECLAIMER:',
                'DELETING:', blocks_to_reclaim);
            await this.delete_blocks_from_nodes(blocks_to_reclaim);
            // return the delay before next batch
            if (this.marker) {
                dbg.log0('AGENT_BLOCKS_RECLAIMER:', 'CONTINUE', this.marker, this.marker.getTimestamp());
                return config.AGENT_BLOCKS_RECLAIMER_BATCH_DELAY;
            }
            dbg.log0('AGENT_BLOCKS_RECLAIMER:', 'END');
            return config.AGENT_BLOCKS_RECLAIMER_RESTART_DELAY;
        } catch (err) {
            // return the delay before next batch
            dbg.error('AGENT_BLOCKS_RECLAIMER:', 'ERROR', err, err.stack);
            return config.AGENT_BLOCKS_RECLAIMER_ERROR_DELAY;
        }
    }

    /**
     * 
     * @param {nb.BlockSchemaDB} blocks 
     */
    async populate_agent_blocks_reclaimer_blocks(blocks) {

        if (!blocks || !blocks.length) return;

        const db_blocks = await this.populate_nodes_for_blocks(blocks);

        // treat blocks that their node could not be populated as "orphan blocks" 
        // that their nodes is missing for some reason (probably deleted)
        const [orphan_blocks, live_blocks] = _.partition(db_blocks, block => db_client.instance().is_object_id(block.node));

        if (orphan_blocks.length) {
            dbg.log0(`identified ${orphan_blocks.length} orphan blocks that their node could not be found. marking them as reclaimed`,
                orphan_blocks);
            // maybe we should mark dead blocks differently so we can do something with them later (report\retry\etc.)
            await this.update_blocks_by_ids(db_client.instance().uniq_ids(orphan_blocks, '_id'), { reclaimed: new Date() });
        }

        return live_blocks;
    }

    /**
     * @override in unit tests for decoupling dependencies
     * 
     * @param  {...any} args 
     * @return {nb.BlockSchemaDB[]}
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
    populate_nodes_for_blocks(blocks) {
        return map_server.prepare_blocks_from_db(blocks);
    }

}

// EXPORTS
exports.AgentBlocksReclaimer = AgentBlocksReclaimer;
