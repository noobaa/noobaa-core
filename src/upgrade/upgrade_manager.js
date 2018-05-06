/* Copyright (C) 2016 NooBaa */
"use strict";

const argv = require('minimist')(process.argv);
const _ = require('lodash');

const promise_utils = require('../util/promise_utils');
const mongo_client = require('../util/mongo_client');
const system_store = require('../server/system_services/system_store').get_instance({ standalone: true });
const dbg = require('../util/debug_module')(__filename);
const supervisor = require('../server/utils/supervisor_ctrl');
const platform_upgrade = require('./platform_upgrade');
const dotenv = require('../util/dotenv');
dotenv.load();

mongo_client.instance().connect();
system_store.load();
dbg.set_process_name('UpgradeManager');

class UpgradeManager {

    constructor(options) {
        this.cluster = options.cluster;
    }

    async init() {
        // get the last stored upgrade stage from DB
        let server = system_store.get_local_cluster_info();
        const upgrade_info = server.upgrade;
        dbg.log0('UPGRADE: upgrade info in db:', upgrade_info);
        this.upgrade_stage = _.get(server, 'upgrade.stage') || 'START_UPGRADE';
        dbg.log0('UPGRADE: last stored upgrade stage is', this.upgrade_stage);
        this.should_upgrade_schemas = upgrade_info.mongo_upgrade;
    }

    async end_upgrade(params = {}) {

        dbg.log0('UPGRADE: ending upgrade process. removing upgrade_manager from supervisor.conf');
        if (!params.aborted) {
            await this.update_db({ 'upgrade.stage': 'UPGRADE_COMPLETED', 'upgrade.status': 'COMPLETED' });
        }
        dbg.log0('UPGRADE: starting services');
        await platform_upgrade.start_services();
        dbg.log0('UPGRADE: removing upgrade_manager from supervisor config');
        await supervisor.remove_program('upgrade_manager');
        dbg.log0('UPGRADE: applying supervisor conf changes. upgrade manager should exit now');
        await supervisor.apply_changes();

    }

    async abort_upgrade(params) {
        try {
            dbg.error('UPGRADE FAILED ¯\\_(ツ)_/¯');
            dbg.error('aborting upgrade with params', params);
            await this.update_db({
                'upgrade.status': 'UPGRADE_FAILED',
                'upgrade.error': params.error,
                'upgrade.stage': 'UPGRADE_ABORTED'
            });

            if (params.rollback) {
                dbg.warn('UPGRADE: restoring previous version');
                await platform_upgrade.restore_old_version();
            }
        } catch (err) {
            dbg.error('UPGRADE: got error while aborting upgrade', err);
        }

        await this.end_upgrade({ aborted: true });
    }


    async update_db(updates) {

        let server = system_store.get_local_cluster_info(); //Update path in DB
        updates.stage_changed_date = Date.now();
        const update = {
            clusters: [{
                _id: server._id,
                $set: updates
            }]
        };
        dbg.log0('UPGRADE: updating upgrade in db', updates);
        await system_store.make_changes({ update });
    }

    async set_upgrade_stage(stage) {
        this.upgrade_stage = stage;
        await this.update_db({ 'upgrade.stage': stage });
    }

    async start_upgrade_stage() {
        await platform_upgrade.stop_services();
        await platform_upgrade.platform_upgrade_init();
    }

    async copy_new_code_stage() {
        await platform_upgrade.copy_new_code();
    }

    async upgrade_platform_stage() {
        await platform_upgrade.run_platform_upgrade_steps();
    }

    async update_services_stage() {
        await platform_upgrade.update_services();
    }

    async upgrade_mongodb_version_stage() {
        await platform_upgrade.upgrade_mongodb_version({
            is_cluster: this.cluster
        });
    }

    async upgrade_mongodb_schemas_stage() {
        await platform_upgrade.upgrade_mongodb_schemas({
            is_cluster: this.cluster,
            should_upgrade_schemas: this.should_upgrade_schemas
        });
    }

    async cleanup_stage() {
        await platform_upgrade.after_upgrade_cleanup();
    }

    async run_upgrade_stages() {
        const UPGRADE_STAGES = Object.freeze([{
            name: 'START_UPGRADE',
            func: () => this.start_upgrade_stage()
        }, {
            name: 'COPY_NEW_CODE',
            func: () => this.copy_new_code_stage(),
            rollback_on_error: true
        }, {
            // from this stage forward rollback is not trivial since we are changing platform components, services,
            // DB version (possibly) and DB schemas. 
            // TODO: better handling of failures in this stage. currently just log and set to DB.
            name: 'UPGRADE_PLATFORM',
            func: () => this.upgrade_platform_stage()
        }, {
            name: 'UPDATE_SERVICES',
            func: () => this.update_services_stage()
        }, {
            name: 'UPGRADE_MONGODB_VER',
            func: () => this.upgrade_mongodb_version_stage()
        }, {
            name: 'UPGRADE_MONGODB_SCHEMAS',
            func: () => this.upgrade_mongodb_schemas_stage()
        }, {
            name: 'CLEANUP',
            func: () => this.cleanup_stage(),
            ignore_errors: true
        }, ]);

        // Run upgrade stage by stage. each stage marks the next stage in DB
        for (let i = 0; i < UPGRADE_STAGES.length; ++i) {
            const stage = UPGRADE_STAGES[i];
            if (this.upgrade_stage === stage.name) {
                try {
                    dbg.log0(`UPGRADE: running upgrade stage - ${stage.name}`);
                    await stage.func();
                    dbg.log0(`UPGRADE: succesfully completed upgrade stage - ${stage.name}`);
                    if (i < UPGRADE_STAGES.length - 1) {
                        // if we are not in the last stage - advance to next stage
                        const next_stage = UPGRADE_STAGES[i + 1].name;
                        await this.set_upgrade_stage(next_stage);
                    }
                } catch (err) {
                    dbg.error(`UPGRADE: got error on upgrade stage - ${stage.name}`, err);
                    if (stage.ignore_errors) {
                        dbg.warn(`UPGRADE: ignoring error for stage ${stage.name}`);
                    } else {
                        dbg.error(`UPGRADE: ABORT UPGRADE on stage ${stage.name}`);
                        await this.abort_upgrade({
                            error: err.message,
                            rollback: stage.rollback_on_error
                        });
                        throw err;
                    }
                }
            }
        }
    }

    async do_upgrade() {
        dbg.log0('UPGRADE: waiting for system_store to load');
        await promise_utils.wait_for_event(system_store, 'load');
        dbg.log0('UPGRADE: system_store loaded. starting do_upgrade flow');

        await this.init();

        await this.run_upgrade_stages();

        dbg.log0('UPGRADE: upgrade completed successfully :)');
        await this.end_upgrade();
    }


}


async function main() {
    dbg.log0('UPGRADE: Started upgrade manager with arguments:', argv);

    const upgrade_manager = new UpgradeManager({
        cluster: argv.cluster_str === 'cluster',
    });

    await upgrade_manager.do_upgrade();
}

if (require.main === module) {
    main();
}
