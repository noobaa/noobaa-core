/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const dbg = require('../util/debug_module')(__filename);
const { make_https_request } = require('../util/http_utils.js');
const { read_stream_join } = require('../util//buffer_utils');
const config = require('../../config');

// Supported APIs
const NOOBAA_IO_API = 'noobaa.io/v1alpha1';
const V1_IO_API = 'v1';

const {
    KUBERNETES_SERVICE_HOST,
    KUBERNETES_SERVICE_PORT
} = process.env;

// Build an rest path for a noobaa api call.
function get_noobaa_path(namespace, noobaa_name) {
    return `/apis/${NOOBAA_IO_API}/namespaces/${namespace}/noobaas/${noobaa_name}`;
}

// Build an rest path for a backingstore api call.
function get_backingstores_path(namespace) {
    return `/apis/${NOOBAA_IO_API}/namespaces/${namespace}/backingstores`;
}

// Build an rest path for a secret api call.
function get_secrets_path(namespace) {
    return `/api/${V1_IO_API}/namespaces/${namespace}/secrets`;
}

class KubeStore {
    static get instance() {
        if (!this._instance) {
            this._instance = new KubeStore(
                KUBERNETES_SERVICE_HOST,
                KUBERNETES_SERVICE_PORT
            );
        }
        return this._instance;
    }

    constructor(service_host, service_port) {
        this._service_host = service_host;
        this._service_port = service_port;
        this._initialized = false;
    }

    async _init() {
        if (this._initialized) {
            return;
        }

        try {
            const buffer = await fs.promises.readFile(config.KUBE_SA_TOKEN_FILE);
            this._sa_token = buffer.toString('utf8').trim();

        } catch (err) {
            throw new Error(`Could not namespace file at "${config.KUBE_SA_TOKEN_FILE}"`);
        }

        try {
            const buffer = await fs.promises.readFile(config.KUBE_NAMESPACE_FILE);
            this._k8s_namespace = buffer.toString('utf8').trim();

        } catch (err) {
            throw new Error(`Could not read service account token file at "${config.KUBE_NAMESPACE_FILE}"`);
        }

        this._initialized = true;
    }

    async _make_k8s_api_request(method, path, body) {
        dbg.log0(`KubeStore._make_k8s_api_request: method: ${method}, path: ${path}, body:`, body);
        if (!this._initialized) {
            throw new Error('Store is not initialized');
        }

        try {
            const content_type = method === 'PATCH' ?
                'application/merge-patch+json' :
                'application/json';

            const response = await make_https_request({
                    method: method,
                    hostname: this._service_host,
                    port: this._service_port,
                    path: path,
                    rejectUnauthorized: false,
                    headers: {
                        'Content-Type': content_type,
                        Accept: 'application/json',
                        Authorization: `Bearer ${this._sa_token}`
                    }
                },
                body && JSON.stringify(body),
                'utf8'
            );

            const status_code = response.statusCode;
            const buffer = await read_stream_join(response);
            const res_body = JSON.parse(buffer.toString('utf8'));
            return {
                status_code,
                body: res_body
            };

        } catch (err) {
            throw new Error(`${method} ${path} did not responed or returned with an error ${err}`);
        }
    }

    async read_noobaa(name = "noobaa") {
        await this._init();
        const path = get_noobaa_path(this._k8s_namespace, name);
        const { status_code, body } = await this._make_k8s_api_request('GET', path);
        switch (status_code) {
            case 200: {
                return body;
            }
            case 404: {
                return null;
            }
            default: {
                throw new Error(`Could not retrive noobaa, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    async patch_noobaa(patch) {
        await this._init();
        const path = get_noobaa_path(this._k8s_namespace, 'noobaa');
        const { status_code, body } = await this._make_k8s_api_request('PATCH', path, patch);
        switch (status_code) {
            case 200: {
                return;
            }
            default: {
                throw new Error(`Could not patch noobaa, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    async create_backingstore(new_store) {
        await this._init();
        const path = get_backingstores_path(this._k8s_namespace);
        const { status_code, body } = await this._make_k8s_api_request('POST', path, new_store);
        switch (status_code) {
            case 201: {
                return;
            }
            default: {
                throw new Error(`Could not create backingstore, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    async delete_backingstore(name) {
        await this._init();
        const path = get_backingstores_path(this._k8s_namespace) + `/${name}`;
        const { status_code, body } = await this._make_k8s_api_request('DELETE', path);
        switch (status_code) {
            case 200: {
                return;
            }
            case 404: { // couldn't find - already deleted
                return;
            }
            default: {
                throw new Error(`Could not delete backingstore, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    async read_backingstore(name) {
        await this._init();
        const path = get_backingstores_path(this._k8s_namespace) + `/${name}`;
        const { status_code, body } = await this._make_k8s_api_request('GET', path);
        switch (status_code) {
            case 200: {
                return body;
            }
            case 404: {
                return null;
            }
            default: {
                throw new Error(`Could not retrive backingstore, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    async patch_backingstore(name, patch) {
        await this._init();
        const path = get_backingstores_path(this._k8s_namespace) + `/${name}`;
        const { status_code, body } = await this._make_k8s_api_request('PATCH', path, patch);
        switch (status_code) {
            case 200: {
                return;
            }
            default: {
                throw new Error(`Could not patch backingstore, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    async create_secret(new_secret) {
        await this._init();
        const path = get_secrets_path(this._k8s_namespace);
        const { status_code, body } = await this._make_k8s_api_request('POST', path, new_secret);
        switch (status_code) {
            case 201: {
                return;
            }
            default: {
                throw new Error(`Could not create secret, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }
}

exports.KubeStore = KubeStore;
