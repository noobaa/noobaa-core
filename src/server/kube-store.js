/* Copyright (C) 2016 NooBaa */
'use strict';

const { K8sApiClient } = require('../util/k8s_api_client');

// Supported APIs
const NOOBAA_IO_API = 'noobaa.io/v1alpha1';
const V1_IO_API = 'v1';

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
            this._instance = new KubeStore();
        }
        return this._instance;
    }

    /**
     * @param {K8sApiClient} [k8s_api_client] - Kubernetes API client (defaults to the shared in-cluster client)
     */
    constructor(k8s_api_client = K8sApiClient.instance) {
        this._k8s_api_client = k8s_api_client;
    }

    /**
     * Read a NooBaa custom resource, or null when it does not exist.
     * @param {string} [name]
     * @returns {Promise<object|null>}
     */
    async read_noobaa(name = "noobaa") {
        const namespace = await this._k8s_api_client.get_namespace();
        const path = get_noobaa_path(namespace, name);
        const { status_code, body } = await this._k8s_api_client.make_k8s_api_request('GET', path);
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

    /**
     * Apply a merge patch to the NooBaa custom resource named "noobaa".
     * @param {object} patch
     * @returns {Promise<void>}
     */
    async patch_noobaa(patch) {
        const namespace = await this._k8s_api_client.get_namespace();
        const path = get_noobaa_path(namespace, 'noobaa');
        const { status_code, body } = await this._k8s_api_client.make_k8s_api_request('PATCH', path, patch);
        switch (status_code) {
            case 200: {
                return;
            }
            default: {
                throw new Error(`Could not patch noobaa, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    /**
     * Create a BackingStore custom resource.
     * @param {object} new_store
     * @returns {Promise<void>}
     */
    async create_backingstore(new_store) {
        const namespace = await this._k8s_api_client.get_namespace();
        const path = get_backingstores_path(namespace);
        const { status_code, body } = await this._k8s_api_client.make_k8s_api_request('POST', path, new_store);
        switch (status_code) {
            case 201: {
                return;
            }
            default: {
                throw new Error(`Could not create backingstore, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    /**
     * Delete a BackingStore custom resource. Missing resources are treated as already deleted.
     * @param {string} name
     * @returns {Promise<void>}
     */
    async delete_backingstore(name) {
        const namespace = await this._k8s_api_client.get_namespace();
        const path = get_backingstores_path(namespace) + `/${name}`;
        const { status_code, body } = await this._k8s_api_client.make_k8s_api_request('DELETE', path);
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

    /**
     * Read a BackingStore custom resource, or null when it does not exist.
     * @param {string} name
     * @returns {Promise<object|null>}
     */
    async read_backingstore(name) {
        const namespace = await this._k8s_api_client.get_namespace();
        const path = get_backingstores_path(namespace) + `/${name}`;
        const { status_code, body } = await this._k8s_api_client.make_k8s_api_request('GET', path);
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

    /**
     * Apply a merge patch to a BackingStore custom resource.
     * @param {string} name
     * @param {object} patch
     * @returns {Promise<void>}
     */
    async patch_backingstore(name, patch) {
        const namespace = await this._k8s_api_client.get_namespace();
        const path = get_backingstores_path(namespace) + `/${name}`;
        const { status_code, body } = await this._k8s_api_client.make_k8s_api_request('PATCH', path, patch);
        switch (status_code) {
            case 200: {
                return;
            }
            default: {
                throw new Error(`Could not patch backingstore, (status code: ${status_code}) got ${JSON.stringify(body)}`);
            }
        }
    }

    /**
     * Create a Kubernetes Secret.
     * @param {object} new_secret
     * @returns {Promise<void>}
     */
    async create_secret(new_secret) {
        const namespace = await this._k8s_api_client.get_namespace();
        const path = get_secrets_path(namespace);
        const { status_code, body } = await this._k8s_api_client.make_k8s_api_request('POST', path, new_secret);
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
