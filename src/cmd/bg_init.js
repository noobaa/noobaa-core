#!/usr/bin/env node
/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const net = require('net');
const { URL } = require('url');

const PACKAGE_JSON_PATH = '/root/node_modules/noobaa-core/package.json';
const VALID_ROLES = new Set(['scanner', 'worker']);

/**
 * Parses the NooBaa package version from package.json.
 * @param {string} [package_json_path]
 * @returns {string}
 */
function read_package_version(package_json_path = process.env.BG_INIT_TEST_PACKAGE_JSON || PACKAGE_JSON_PATH) {
    const pkg = JSON.parse(fs.readFileSync(package_json_path, 'utf8'));
    if (typeof pkg.version !== 'string' || !pkg.version) {
        throw new Error(`version not found in ${package_json_path}`);
    }
    return pkg.version;
}

/**
 * Validates NOOBAA_BG_ROLE for BG workers pods (scanner or worker).
 * @param {string|undefined} role
 * @returns {string}
 */
function validate_bg_role(role = process.env.NOOBAA_BG_ROLE) {
    if (!role || !VALID_ROLES.has(role)) {
        throw new Error(
            `NOOBAA_BG_ROLE must be one of ${[...VALID_ROLES].join('|')} (got ${role === undefined ? 'undefined' : JSON.stringify(role)})`
        );
    }
    return role;
}

/**
 * Returns true when host:port accepts a TCP connection.
 * @param {string} host
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function tcp_reachable(host, port) {
    return new Promise(resolve => {
        const socket = net.connect({ host, port }, () => {
            socket.end();
            resolve(true);
        });
        socket.setTimeout(3000, () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

/**
 * Waits until MGMT_ADDR accepts TCP. Scanner pods start independently of core,
 * so SystemStore must not call register_to_cluster before WebServer is listening.
 * No-op when MGMT_ADDR is unset (unit tests, in-process fcall).
 * @param {string} [addr]
 * @param {{ timeout_ms?: number, interval_ms?: number }} [options]
 * @returns {Promise<void>}
 */
async function wait_for_mgmt_addr(addr = process.env.MGMT_ADDR, options = {}) {
    if (!addr) return;
    const timeout_ms = options.timeout_ms === undefined ?
        (Number(process.env.BG_INIT_MGMT_WAIT_MS) || 180000) :
        options.timeout_ms;
    const interval_ms = options.interval_ms === undefined ? 2000 : options.interval_ms;
    const u = new URL(addr);
    const port = Number(u.port) || ((u.protocol === 'wss:' || u.protocol === 'https:') ? 443 : 80);
    const host = u.hostname;
    const deadline = Date.now() + timeout_ms;
    while (Date.now() < deadline) {
        if (await tcp_reachable(host, port)) {
            console.log(`mgmt reachable at ${host}:${port}`);
            return;
        }
        console.log(`waiting for mgmt ${host}:${port}`);
        await new Promise(resolve => setTimeout(resolve, interval_ms));
    }
    throw new Error(`MGMT_ADDR ${addr} not reachable within ${timeout_ms}ms`);
}

/**
 * NooBaa BG pod entry point. Starts bg_workers.main() after role validation.
 * @returns {Promise<void>}
 */
async function start() {
    const version = read_package_version();
    console.log(`Version is: ${version}`);
    const role = validate_bg_role();
    console.log(`running bg init role=${role}`);
    await wait_for_mgmt_addr();
    // Load bg_workers only after mgmt is up so SystemStore's initial RPC register cannot panic.
    const bg_workers = require('../server/bg_workers');
    await bg_workers.main();
}

async function main() {
    try {
        await start();
    } catch (err) {
        console.log(err.message || err);
        /** @type {Error & { exitCode?: number }} */
        const exit_err = err;
        process.exit(exit_err.exitCode ?? 1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    PACKAGE_JSON_PATH,
    VALID_ROLES,
    read_package_version,
    validate_bg_role,
    wait_for_mgmt_addr,
    start,
};
