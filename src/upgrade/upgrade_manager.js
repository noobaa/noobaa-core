/* Copyright (C) 2016 NooBaa */
"use strict";

const argv = require('minimist')(process.argv);

const promise_utils = require('../util/promise_utils');
const mongo_client = require('../util/mongo_client');
const system_store = require('../server/system_services/system_store').get_instance({ standalone: true });
const dbg = require('../util/debug_module')(__filename);
const supervisor = require('../server/utils/supervisor_ctrl');
const platform_upgrade = require('./platform_upgrade');
const dotenv = require('../util/dotenv');
dotenv.load();

const REQUIRED_MONGODB_VERSION = '3.6.5';

mongo_client.instance().connect();
system_store.load();
dbg.set_process_name('UpgradeManager');

class UpgradeManager {

    constructor(options) {
        this.cluster = options.cluster;
        this.old_version = options.old_version;
    }

    async init() {
        await this.init_upgrade_info();

        // define the upgrade stages order.
        // upgrade stages will run one by one serially by run_upgrade_stages
        this.UPGRADE_STAGES = Object.freeze([{
                // stop services
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
            },
            // currently upgrade is being run serially on all cluster members so running
            // UPDATE_SERVICES and UPGRADE_MONGODB_VER does not need synchronization here.
            // TODO: we can and should run the upgrade stages in parallel up to this point
            // and only sync the next 2 stages to run serially.
            {
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
            },
        ]);
    }

    // get the last stored upgrade stage and other information
    async init_upgrade_info() {
        this.upgrade_info = await platform_upgrade.get_upgrade_info();
        if (!this.upgrade_info) {
            dbg.log0('did not find a previously stored upgrade_info. initializing from DB');
            let server = system_store.get_local_cluster_info();
            const upgrade_info = server.upgrade;
            dbg.log0('UPGRADE: upgrade info in db:', upgrade_info);
            this.upgrade_info = {
                stage: 'START_UPGRADE',
                ip: server.owner_address,
                should_upgrade_schemas: upgrade_info.mongo_upgrade
            };
            dbg.log0('initialized upgrade_');
        }
        dbg.log0('upgrade info:', this.upgrade_info);
    }


    async end_upgrade(params = {}) {

        dbg.log0('UPGRADE: ending upgrade process. removing upgrade_manager from supervisor.conf');
        try {
            if (!params.aborted) {
                await this.update_db({ 'upgrade.stage': 'UPGRADE_COMPLETED', 'upgrade.status': 'COMPLETED' });
            }
        } catch (err) {
            dbg.error('UPGRADE: failed updating DB with UPGRADE_COMPLETED');
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
            const update = {
                'upgrade.status': 'UPGRADE_FAILED',
                'upgrade.error': params.error,
                'upgrade.stage': 'UPGRADE_ABORTED'
            };
            try {
                await this.update_db(update);
            } catch (err) {
                dbg.error('UPGRADE: failed updating DB with', update);
            }

            if (params.rollback) {
                dbg.warn('UPGRADE: restoring previous version');
                try {
                    await platform_upgrade.restore_old_version();
                } catch (err) {
                    dbg.error(`UPGRADE: failed restoring back to old version ${this.old_version}`);
                }
            }
        } catch (err) {
            dbg.error('UPGRADE: got error while aborting upgrade', err);
        }

        await this.end_upgrade({ aborted: true });
    }

    async get_mongo_db_version() {
        try {
            const res = await promise_utils.exec(`mongod --version | head -n 1`, {
                return_stdout: true
            });
            if (!res.startsWith('db version v')) {
                throw new Error(`unexpected version output. got ${res}`);
            }
            return res.replace('db version v', '');
        } catch (err) {
            dbg.error(`got error when trying to get mongodb version`, err);
            throw err;
        }
    }

    async update_db(updates) {

        let server = system_store.get_local_cluster_info(); //Update path in DB
        const update = {
            clusters: [{
                _id: server._id,
                $set: updates
            }]
        };
        dbg.log0('UPGRADE: updating upgrade in db', updates);
        await system_store.make_changes_with_retries({ update }, {
            max_retries: 60,
            delay: 5000
        });
    }

    async set_upgrade_info(stage) {
        this.upgrade_info.stage = stage;
        await platform_upgrade.set_upgrade_info(this.upgrade_info);
    }

    async start_upgrade_stage() {
        await platform_upgrade.stop_services();
        await platform_upgrade.platform_upgrade_init();
    }

    async copy_new_code_stage() {
        await platform_upgrade.copy_new_code();
    }

    async upgrade_platform_stage() {
        await platform_upgrade.run_platform_upgrade_steps(this.old_version);
    }

    async update_services_stage() {
        await platform_upgrade.update_services(this.old_version);
    }

    async upgrade_mongodb_version_stage() {
        const mongo_version = await this.get_mongo_db_version();
        this.upgrade_mongodb = platform_upgrade.version_compare(mongo_version, REQUIRED_MONGODB_VERSION) < 0;
        dbg.log0(`UPGRADE: current mongodb version is ${mongo_version}, requiered mongodb version is ${REQUIRED_MONGODB_VERSION}`,
            this.upgrade_mongodb ? 'upgrading to requiered version' : 'upgrade is not required');
        await platform_upgrade.upgrade_mongodb_version({
            should_upgrade_mongodb: this.upgrade_mongodb,
            required_mongodb_version: REQUIRED_MONGODB_VERSION,
            is_cluster: this.cluster,
            ip: this.owner_address
        });
    }

    async upgrade_mongodb_schemas_stage() {
        const [major, minor] = REQUIRED_MONGODB_VERSION.split('.');
        const feature_version = [major, minor].join('.');
        await platform_upgrade.upgrade_mongodb_schemas({
            is_cluster: this.cluster,
            should_upgrade_schemas: this.upgrade_info.should_upgrade_schemas,
            mongodb_upgraded: this.upgrade_mongodb,
            feature_version,
            old_version: this.old_version,
            ip: this.upgrade_info.ip
        });
    }

    async cleanup_stage() {
        await platform_upgrade.after_upgrade_cleanup();
    }

    async run_upgrade_stages() {
        // Run upgrade stage by stage. each stage marks the next stage in DB
        for (let i = 0; i < this.UPGRADE_STAGES.length; ++i) {
            const stage = this.UPGRADE_STAGES[i];
            if (this.upgrade_info.stage === stage.name) {
                try {
                    dbg.log0(`UPGRADE: running upgrade stage - ${stage.name}`);
                    await stage.func();
                    dbg.log0(`UPGRADE: succesfully completed upgrade stage - ${stage.name}`);
                    if (i < this.UPGRADE_STAGES.length - 1) {
                        // if we are not in the last stage - advance to next stage
                        const next_stage = this.UPGRADE_STAGES[i + 1].name;
                        await this.set_upgrade_info(next_stage);
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
        old_version: argv.old_version
    });

    await upgrade_manager.do_upgrade();
}

if (require.main === module) {
    main();
}
