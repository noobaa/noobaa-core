#!/usr/bin/env node
/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);

// TODO: drop 'scanner' once the operator stops sending it (bg-workers role rename PR).
const VALID_ROLES = new Set(['scanner', 'worker', 'consumer']);

/**
 * Validates NOOBAA_BG_ROLE for BG pods (scanner, worker, or consumer).
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

/** @type {NodeJS.Timeout|undefined} */
let consumer_keep_alive;

/** @type {(() => void)|undefined} */
let consumer_sigterm_handler;

/**
 * Never-resolving sleep that keeps the Node event loop alive.
 * An empty `new Promise(() => {})` lets Node exit with code 0 (no open handles),
 * which makes the consumer pod show Completed / flap under a Deployment.
 * @returns {Promise<void>}
 */
function sleep_forever() {
    return new Promise(() => {
        // Long interval is enough as an event-loop handle; callback is a no-op.
        // Reuse an existing interval so a second call cannot orphan the first timer.
        if (consumer_keep_alive === undefined) {
            consumer_keep_alive = setInterval(() => { /* keep alive */ }, 24 * 60 * 60 * 1000);
        }
    });
}

/**
 * Installs a SIGTERM handler so consumer pods exit promptly.
 * Operator runs `exec node bg_init.js`, so Node is PID 1 and Linux ignores
 * the default SIGTERM disposition until a handler is installed.
 * @returns {void}
 */
function install_consumer_sigterm_handler() {
    if (consumer_sigterm_handler) return;
    consumer_sigterm_handler = () => {
        dbg.log0('consumer role: got SIGTERM, exiting');
        process.exit(0);
    };
    process.once('SIGTERM', consumer_sigterm_handler);
}

/**
 * Clears consumer keep-alive state so unit tests can exit.
 * @returns {void}
 */
function clear_consumer_keep_alive_for_tests() {
    if (consumer_keep_alive !== undefined) {
        clearInterval(consumer_keep_alive);
        consumer_keep_alive = undefined;
    }
    if (consumer_sigterm_handler) {
        process.removeListener('SIGTERM', consumer_sigterm_handler);
        consumer_sigterm_handler = undefined;
    }
}

/**
 * NooBaa BG pod entry point. Starts bg_workers.main() for scanner/worker
 * (singleton main BG pod). Consumer role sleeps forever until the MQ consumer
 * path lands in a follow-up.
 * @returns {Promise<void>}
 */
async function start() {
    const role = validate_bg_role();
    dbg.log0(`running bg init role=${role}`);
    if (role === 'consumer') {
        // Operator already deploys consumers; core MQ consumer work is not ready yet.
        // Sleep instead of running the full bg_workers.main() (would duplicate the worker STS).
        dbg.log0('consumer role: sleeping until MQ consumer path is implemented');
        install_consumer_sigterm_handler();
        await sleep_forever();
        return;
    }
    // scanner and worker both run the singleton BG main process.
    const bg_workers = require('../server/bg_workers');
    await bg_workers.main();
}

async function main() {
    try {
        await start();
    } catch (err) {
        dbg.error(err.message || err);
        /** @type {Error & { exitCode?: number }} */
        const exit_err = err;
        process.exit(exit_err.exitCode ?? 1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    VALID_ROLES,
    validate_bg_role,
    start,
    sleep_forever,
    clear_consumer_keep_alive_for_tests,
};
