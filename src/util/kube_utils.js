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

function apply_conf(conf) {
    return os_utils.exec(
        `echo '${JSON.stringify(conf)}' | kubectl apply -f -`,
        { return_stdout: true }
    );
}

function list_resources(resource_type, selector = '') {
    const selector_opt = selector ? `--selector="${selector}"` : '';
    return exec_kubectl(`get ${resource_type} ${selector_opt}`, 'json');
}

function get_resource(resource_type, resource_name) {
    return exec_kubectl(`get ${resource_type} ${resource_name}`, 'json');
}

function patch_resource(resource_type, resource_name, patch) {
    return exec_kubectl(`patch ${resource_type} ${resource_name} -p='${JSON.stringify(patch)}'`, 'json');
}

function delete_resource(resource_type, resource_name) {
    return exec_kubectl(`delete ${resource_type} ${resource_name}`, 'name');
}

async function resource_exists(resource_type, resource_name) {
    try {
        await exec_kubectl(`get ${resource_type} ${resource_name}`, 'none');
        return true;
    } catch (err) {
        return false;
    }
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

function wait_for_delete(resource_type, resource_name, timeout = 300) {
    return exec_kubectl(
        `wait ${resource_type} ${resource_name} --for=delete --timeout=${timeout}s`,
        'json'
    );
}

function wait_for_condition(resource_type, resource_name, condition, timeout = 300) {
    return exec_kubectl(
        `wait ${resource_type} ${resource_name} --for condition=${condition} --timeout=${timeout}s`,
        'json'
    );
}

exports.read_namespace = read_namespace;
exports.read_sa_token = read_sa_token;
exports.apply_conf = apply_conf;
exports.list_resources = list_resources;
exports.get_resource = get_resource;
exports.patch_resource = patch_resource;
exports.delete_resource = delete_resource;
exports.resource_exists = resource_exists;
exports.wait_for_delete = wait_for_delete;
exports.wait_for_condition = wait_for_condition;
exports.api_exists = api_exists;
