/* Copyright (C) 2016 NooBaa */
"use strict";

const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const dbg = require('../util/debug_module')(__filename);

/**
 * @param {string} ver
 */
function parse_ver(ver) {
    const stripped_ver = ver.split('-')[0];
    return stripped_ver.split('.').map(i => Number.parseInt(i, 10));
}


/**
 * version_compare compares 2 versions. returns positive if ver1 is larger, negative if ver2, 0 if equal
 * @param {string} ver1
 * @param {string} ver2
 */
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

/**
 * @param {string} current_version
 * @param {string} new_version
 */
function should_upgrade(current_version, new_version) {
    if (!current_version) {
        dbg.log('system does not exist. no need for an upgrade');
        return false;
    }
    const ver_comparison = version_compare(new_version, current_version);
    if (ver_comparison === 0) {
        if (current_version !== new_version) {
            dbg.warn(`the new_version and current_version (server) appear to be the same version but different builds. (new_version: ${new_version}), (current_version: ${current_version})`);
            dbg.warn(`upgrade is not supported for different builds of the same version!!`);
        }
        dbg.log0('the versions of the new_version and the current_version match. no need to upgrade');
        return false;
    } else if (ver_comparison < 0) {
        // new_version is older than the current server version - can't downgrade
        dbg.error(`the new_version (${new_version}) appears to be older than the current_version (server)  (${current_version}). cannot downgrade`);
        throw new Error('attempt to upgrade to an older version while server\'s version is newer');
    } else {
        dbg.log0(`new_version is ${new_version} and current server version is ${current_version}. will upgrade`);
        return true;
    }
}

/**
 * load_required_scripts loads all scripts that should be run according to the given versions
 * @param {string} current_version
 * @param {string} new_version
 * @param {string} upgrade_scripts_dir
 */
async function load_required_scripts(current_version, new_version, upgrade_scripts_dir) {
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
    // get all dirs for versions newer than current_version
    const newer_versions = upgrade_dir_content.filter(ver =>
            version_compare(ver, current_version) > 0 &&
            version_compare(ver, new_version) <= 0)
        .sort(version_compare);
    dbg.log0(`found the following versions with upgrade scripts which are newer than server version (${current_version}):`, newer_versions);
    // get all scripts under new_versions
    const upgrade_scripts = _.flatMap(newer_versions, ver => {
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

/**
 * 
 * @param {Object} this_upgrade 
 * @param {string} upgrade_scripts_dir 
 * @param {{
    * dbg?: *, 
    * db_client?: import('../util/db_client'), 
    * system_store?: import('../server/system_services/system_store').SystemStore, 
    * system_server?: import('../server/system_services/system_server'),
    * from_version?: String
 * }} options 
 */
async function run_upgrade_scripts(this_upgrade, upgrade_scripts_dir, options) {
    const from_version = this_upgrade.from_version || this_upgrade.config_dir_from_version;
    const to_version = this_upgrade.to_version || this_upgrade.config_dir_to_version;
    const upgrade_scripts = await load_required_scripts(from_version, to_version, upgrade_scripts_dir);
    for (const script of upgrade_scripts) {
        dbg.log0(`upgrade_utils.run_upgrade_scripts: running upgrade script ${script.file}: ${script.description}`);
        try {
            await script.run(options);
            this_upgrade.completed_scripts.push(script.file);
        } catch (err) {
            dbg.error(`upgrade_utils.run_upgrade_scripts: failed running upgrade script ${script.file}`, err);
            this_upgrade.error = err.stack;
            throw err;
        }
    }
}

exports.should_upgrade = should_upgrade;
exports.load_required_scripts = load_required_scripts;
exports.version_compare = version_compare;
exports.run_upgrade_scripts = run_upgrade_scripts;
