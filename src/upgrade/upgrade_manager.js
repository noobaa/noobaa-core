/* Copyright (C) 2016 NooBaa */
"use strict";

const argv = require('minimist')(process.argv);
const _ = require('lodash');
const pkg = require('../../package.json');
const { should_upgrade, run_upgrade_scripts } = require('./upgrade_utils');
const dbg = require('../util/debug_module')('UPGRADE');
dbg.set_process_name('Upgrade');

const { upgrade_scripts_dir } = argv;

/////////////////////////////
//       DB UPGRADES       //
/////////////////////////////


async function init_db_upgrade(db_client, system_store) {
    try {
        dbg.log0('waiting for system_store to load');
        await db_client.instance().connect();
        await system_store.load();
        dbg.log0('system store loaded');
    } catch (err) {
        dbg.error('failed to load system store!!', err);
        throw err;
    }
}

async function upgrade_db() {
    const system_store = require('../server/system_services/system_store').get_instance({ standalone: true });
    const system_server = require('../server/system_services/system_server');
    const db_client = require('../util/db_client');

    try {
        await init_db_upgrade(db_client, system_store);
    } catch (error) {
        dbg.error('failed to init upgrade process!!');
        process.exit(1);
    }

    let exit_code = 0;
    const container_version = pkg.version;
    const server_version = _.get(system_store, 'data.systems.0.current_version');
    let current_version = server_version;
    if (should_upgrade(server_version, container_version)) {
        const this_upgrade = {
            timestamp: Date.now(),
            completed_scripts: [],
            from_version: server_version,
            to_version: container_version
        };
        const upgrade_history = system_store.data.systems[0].upgrade_history;
        try {
            await run_upgrade_scripts(this_upgrade, upgrade_scripts_dir, { dbg, db_client, system_store, system_server });
            upgrade_history.successful_upgrades = [this_upgrade, ...upgrade_history.successful_upgrades];
            current_version = container_version;
        } catch (err) {
            dbg.error('upgrade manager failed!!!', err);
            exit_code = 1;
            if (upgrade_history) {
                upgrade_history.last_failure = this_upgrade;
                upgrade_history.last_failure.error = err.stack;
            }
        }
        // update upgrade_history
        try {
            await system_store.make_changes_with_retries({
                update: {
                    systems: [{
                        _id: system_store.data.systems[0]._id,
                        $set: { upgrade_history, current_version }
                    }]
                }
            }, { max_retries: 10, delay: 30000 });
        } catch (error) {
            dbg.error('failed to update system_store with upgrade information');
            exit_code = 1;
        }
    }

    return exit_code;
}

async function run_upgrade() {
    return upgrade_db();
}

async function main() {
    if (!upgrade_scripts_dir) {
        dbg.error('--upgrade_scripts_dir argument must be provided');
        process.exit(1);
    }
    dbg.log0('upgrade manager started..');
    let exit_code = 0;
    try {
        exit_code = await run_upgrade();
        dbg.log0('upgrade completed successfully!');
    } catch (err) {
        dbg.error('upgrade failed!!', err);
        exit_code = 1;
    }
    process.exit(exit_code);
}

if (require.main === module) {
    main();
}

