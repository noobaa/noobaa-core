/* Copyright (C) 2024 NooBaa */
'use strict';

/**
 * This module exists so as to export the common function `getGlacierBackend`
 * 
 * Keeping this in the generic.js creates cyclic dependency issue.w
 */

const config = require('../../../config');
const { TapeCloudGlacierBackend } = require('./tapecloud');
// eslint-disable-next-line no-unused-vars
const { GlacierBackend } = require('./backend');

/**
 * getGlacierBackend returns appropriate backend for the provided type
 * @param {string} [typ]
 * @returns {GlacierBackend}
 */
function getGlacierBackend(typ = config.NSFS_GLACIER_BACKEND) {
    switch (typ) {
    case 'TAPECLOUD':
        return new TapeCloudGlacierBackend();
    default:
        throw new Error('invalid backend type provide');
    }
}

exports.getGlacierBackend = getGlacierBackend;
