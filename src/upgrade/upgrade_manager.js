/* Copyright (C) 2016 NooBaa */
"use strict";


const argv = require('minimist')(process.argv);
const _ = require('lodash');
const pkg = require('../../package.json');
const fs = require('fs');
const path = require('path');

const system_store = require('../server/system_services/system_store').get_instance({ standalone: true });
const system_server = require('../server/system_services/system_server');
const dbg = require('../util/debug_module')('UPGRADE');
const db_client = require('../util/db_client');
dbg.set_process_name('Upgrade');

function parse_ver(ver) {
    const stripped_ver = ver.split('-')[0];
    return stripped_ver.split('.').map(i => Number.parseInt(i, 10));
}

const { upgrade_scripts_dir } = argv;


// compares 2 versions. returns positive if ver1 is larger, negative if ver2, 0 if equal
function version_compare(ver1, ver2) {
    const ver1_arr = parse_ver(ver1);
    const ver2_arr = parse_ver(ver2);
    const max_length = Math.max(ver1_arr.length, ver2_arr.length);
    for (let i = 0; i < max_length; ++i) {
        const comp1 = ver1_arr[i] || 0;
        const comp2 = ver2_arr[i] || 0;
        const diff = comp1 - comp2;
        // if version component is not the same, return the difference
        if (diff) return diff;
    }
    return 0;
}



async function init() {
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


function should_upgrade(server_version, container_version) {
    if (!server_version) {
        dbg.log('system does not exist. no need for an upgrade');
        return false;
    }
    const ver_comparison = version_compare(container_version, server_version);
    if (ver_comparison === 0) {
        if (server_version !== container_version) {
            dbg.warn(`the container and server appear to be the same version but different builds. (container: ${container_version}), (server: ${server_version})`);
            dbg.warn(`upgrade is not supported for different builds of the same version!!`);
        }
        dbg.log0('the versions of the container and the server match. no need to upgrade');
        return false;
    } else if (ver_comparison < 0) {
        // container version is older than the server version - can't downgrade
        dbg.error(`the container version (${container_version}) appear to be older than the current server version (${server_version}). cannot downgrade`);
        throw new Error('attempt to run old container version with newer server version');
    } else {
        dbg.log0(`container version is ${container_version} and server version is ${server_version}. will upgrade`);
        return true;
    }
}


// load all scripts that should be run according to the given versions
async function load_required_scripts(server_version, container_version) {
    // expecting scripts directories to be in a semver format. e.g. ./upgrade_scripts/5.0.1
    let upgrade_dir_content = [];
    try {
        upgrade_dir_content = fs.readdirSync(upgrade_scripts_dir);
    } catch (err) {
        if (err.code === 'ENOENT') {
            dbg.warn(`upgrade scripts directory "${upgrade_scripts_dir}" was not found. treating it as empty`);
        } else {
            throw err;
        }
    }
    // get all dirs for versions newer than server_version
    const newer_versions = upgrade_dir_content.filter(ver =>
            version_compare(ver, server_version) > 0 &&
            version_compare(ver, container_version) <= 0)
        .sort(version_compare);
    dbg.log0(`found the following versions with upgrade scripts which are newer than server version (${server_version}):`, newer_versions);
    // get all scripts under new_versions
    let upgrade_scripts = _.flatMap(newer_versions, ver => {
        const full_path = path.join(upgrade_scripts_dir, ver);
        const scripts = fs.readdirSync(full_path);
        return scripts.map(script => path.join(full_path, script));
    });

    // TODO: we might want to filter out scripts that have run in a previous run of upgrade(e.g. in case of a crash)
    // for now assume that any upgrade script can be rerun safely

    // for each script load the js file. expecting the export to return an object in the format
    // {
    //      description: 'what this upgrade script does'
    //      run: run_func,
    // }
    return upgrade_scripts.map(script => ({
        ...require(script), // eslint-disable-line global-require
        file: script
    }));
}


async function run_upgrade() {
    try {
        await init();
    } catch (error) {
        dbg.error('failed to init upgrade process!!');
        process.exit(1);
    }

    let exit_code = 0;
    const container_version = pkg.version;
    let server_version = _.get(system_store, 'data.systems.0.current_version');
    let current_version = server_version;
    if (should_upgrade(server_version, container_version)) {
        const this_upgrade = {
            timestamp: Date.now(),
            completed_scripts: [],
            from_version: server_version,
            to_version: container_version
        };
        let upgrade_history = system_store.data.systems[0].upgrade_history;
        try {
            const upgrade_scripts = await load_required_scripts(server_version, container_version);
            for (const script of upgrade_scripts) {
                dbg.log0(`running upgrade script ${script.file}: ${script.description}`);
                try {
                    await script.run({ dbg, db_client, system_store, system_server });
                    this_upgrade.completed_scripts.push(script.file);
                } catch (err) {
                    dbg.error(`failed running upgrade script ${script.file}`, err);
                    this_upgrade.error = err.stack;
                    throw err;
                }
            }
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
