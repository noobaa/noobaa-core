/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const dbg = require('./debug_module')(__filename);
const { make_https_request } = require('./http_utils.js');
const { read_stream_join } = require('./buffer_utils');
const config = require('../../config');

const ROUTE_API_GROUP = 'route.openshift.io';
const V1_API = 'v1';

const {
    KUBERNETES_SERVICE_HOST,
    KUBERNETES_SERVICE_PORT
} = process.env;

/**
 * Build a REST path for listing Services in a namespace.
 * @param {string} namespace
 * @param {string} [label_selector]
 * @returns {string}
 */
function get_services_path(namespace, label_selector = '') {
    const query = label_selector ? `?labelSelector=${encodeURIComponent(label_selector)}` : '';
    return `/api/${V1_API}/namespaces/${namespace}/services${query}`;
}

/**
 * Build a REST path for listing OpenShift Routes in a namespace.
 * @param {string} namespace
 * @param {string} [label_selector]
 * @returns {string}
 */
function get_routes_path(namespace, label_selector = '') {
    const query = label_selector ? `?labelSelector=${encodeURIComponent(label_selector)}` : '';
    return `/apis/${ROUTE_API_GROUP}/${V1_API}/namespaces/${namespace}/routes${query}`;
}

/**
 * Build a REST path for probing an API group at version v1.
 * @param {string} api_group
 * @returns {string}
 */
function get_api_group_path(api_group) {
    return `/apis/${api_group}/${V1_API}`;
}

class K8sApiClient {
    static get instance() {
        if (!this._instance) {
            this._instance = new K8sApiClient(
                KUBERNETES_SERVICE_HOST,
                KUBERNETES_SERVICE_PORT
            );
        }
        return this._instance;
    }

    /**
     * @param {string | undefined} service_host
     * @param {string | undefined} service_port
     */
    constructor(service_host, service_port) {
        this._service_host = service_host;
        this._service_port = service_port;
        this._initialized = false;
        this._sa_token = '';
        this._k8s_namespace = '';
    }

    /**
     * Load in-cluster service account token and namespace from the standard mount paths.
     */
    async _init() {
        if (this._initialized) {
            return;
        }

        try {
            const buffer = await fs.promises.readFile(config.KUBE_SA_TOKEN_FILE);
            this._sa_token = buffer.toString('utf8').trim();

        } catch (err) {
            throw new Error(`Could not read service account token file at "${config.KUBE_SA_TOKEN_FILE}"`);
        }

        try {
            const buffer = await fs.promises.readFile(config.KUBE_NAMESPACE_FILE);
            this._k8s_namespace = buffer.toString('utf8').trim();

        } catch (err) {
            throw new Error(`Could not read namespace file at "${config.KUBE_NAMESPACE_FILE}"`);
        }

        this._initialized = true;
    }

    /**
     * Issue an HTTPS request to the Kubernetes API server.
     * @param {string} method - HTTP method
     * @param {string} path - API path (including query string)
     * @param {object} [body] - Optional JSON body
     * @returns {Promise<{ status_code: number, body: object }>}
     */
    async make_k8s_api_request(method, path, body) {
        await this._init();
        dbg.log0(`K8sApiClient.make_k8s_api_request: method: ${method}, path: ${path}, body:`, body);

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
            throw new Error(`${method} ${path} did not respond or returned with an error ${err}`);
        }
    }

    /**
     * List Services in the pod namespace, optionally filtered by label selector.
     * @param {string} [label_selector] - Kubernetes label selector (e.g. "app=noobaa")
     * @returns {Promise<object>} Service List object (includes items)
     */
    async list_services(label_selector = '') {
        await this._init();
        const path = get_services_path(this._k8s_namespace, label_selector);
        const { status_code, body } = await this.make_k8s_api_request('GET', path);
        if (status_code === 200) {
            return body;
        }
        throw new Error(`GET ${path} unexpected status ${status_code}: ${JSON.stringify(body)}`);
    }

    /**
     * List OpenShift Routes in the pod namespace, optionally filtered by label selector.
     * @param {string} [label_selector] - Kubernetes label selector
     * @returns {Promise<object>} Route List object (includes items)
     */
    async list_routes(label_selector = '') {
        await this._init();
        const path = get_routes_path(this._k8s_namespace, label_selector);
        const { status_code, body } = await this.make_k8s_api_request('GET', path);
        if (status_code === 200) {
            return body;
        }
        throw new Error(`GET ${path} unexpected status ${status_code}: ${JSON.stringify(body)}`);
    }

    /**
     * Return whether an API group is registered (e.g. route.openshift.io on OpenShift).
     * @param {string} api_group - API group name without version
     * @returns {Promise<boolean>}
     */
    async probe_api_group(api_group) {
        const path = get_api_group_path(api_group);
        const { status_code, body } = await this.make_k8s_api_request('GET', path);
        if (status_code === 200) {
            return true;
        }
        if (status_code === 404) {
            return false;
        }
        throw new Error(`GET ${path} unexpected status ${status_code}: ${JSON.stringify(body)}`);
    }
}

exports.K8sApiClient = K8sApiClient;
