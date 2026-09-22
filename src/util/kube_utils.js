/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const config = require('../../config');
const os_utils = require('./os_utils');

function _default_error_factory(message) {
    return new Error(message);
}

async function read_namespace(make_error = _default_error_factory) {
    try {
        const buffer = await fs.promises.readFile(config.KUBE_NAMESPACE_FILE);
        return buffer.toString('utf8').trim();

    } catch (err) {
        throw make_error(`Could not read service account token file at "${config.KUBE_NAMESPACE_FILE}"`);
    }
}

async function read_sa_token(make_error = _default_error_factory) {
    try {
       const buffer = await fs.promises.readFile(config.KUBE_SA_TOKEN_FILE);
       return buffer.toString('utf8').trim();

    } catch (err) {
        throw make_error(`Could not namespace file at "${config.KUBE_SA_TOKEN_FILE}"`);
    }
}

async function exec_kubectl(command, output_format) {
    output_format = output_format.toLowerCase();

    const output_opt = (output_format === 'none' || output_format === 'raw') ?
        '' :
        `-o=${output_format}`;

    const response = await os_utils.exec(
        `kubectl ${command} ${output_opt}`,
        { return_stdout: true }
    );

    if (output_format === 'none') {
        return '';

    } else if (output_format === 'json') {
        return JSON.parse(response);

    } else {
        return response;
    }
}

function list_resources(resource_type, selector = '') {
    const selector_opt = selector ? `--selector="${selector}"` : '';
    return exec_kubectl(`get ${resource_type} ${selector_opt}`, 'json');
}

async function api_exists(api_name, api_version = '') {
    const text = await exec_kubectl(`api-versions`, 'raw');
    return text
        .split('\n')
        .some(api => {
            const [name, version] = api.split('/');
            return api_version ?
                (api_name === name && api_version === version) :
                (api_name === name);
        });
}

exports.read_namespace = read_namespace;
exports.read_sa_token = read_sa_token;
exports.list_resources = list_resources;
exports.api_exists = api_exists;
