#!/usr/bin/env node
/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);

const VALID_ROLES = new Set(['scanner', 'worker']);

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
 * NooBaa BG pod entry point. Starts bg_workers.main() after role validation.
 * @returns {Promise<void>}
 */
async function start() {
    const role = validate_bg_role();
    dbg.log0(`running bg init role=${role}`);
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
};
