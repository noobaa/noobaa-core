/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const config = require('../../config');

function _default_error_factory(message) {
    return new Error(message);
}

async function read_namespace(makeError = _default_error_factory) {
    try {
        const buffer = await fs.readFileAsync(config.KUBE_NAMESPACE_FILE);
        return buffer.toString('utf8').trim();

    } catch (err) {
        throw makeError(`Could not read service account token file at "${config.KUBE_NAMESPACE_FILE}"`);
    }
}

async function read_sa_token(makeError = _default_error_factory) {
    try {
       const buffer = await fs.readFileAsync(config.KUBE_SA_TOKEN_FILE);
       return buffer.toString('utf8').trim();

    } catch (err) {
        throw makeError(`Could not namespace file at "${config.KUBE_SA_TOKEN_FILE}"`);
    }
}

exports.read_namespace = read_namespace;
exports.read_sa_token = read_sa_token;
