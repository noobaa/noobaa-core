/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const config = require('../../config');
const dbg = require('./debug_module')(__filename);
const { K8sApiClient } = require('./k8s_api_client');

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

/**
 * List Kubernetes resources of the given type in the pod namespace.
 * @param {string} resource_type - Supported values: "service", "route"
 * @param {string} [selector] - Kubernetes label selector (e.g. "app=noobaa")
 * @returns {Promise<object>} List object (includes items)
 */
async function list_resources(resource_type, selector = '') {
    const client = K8sApiClient.instance;
    if (resource_type === 'service') {
        return client.list_services(selector);
    }
    if (resource_type === 'route') {
        return client.list_routes(selector);
    }
    throw new Error(`Unsupported resource type for list_resources: ${resource_type}`);
}

/**
 * Return whether an API group is registered on the cluster (probes v1).
 * @param {string} api_name - API group name without version (e.g. "route.openshift.io")
 * @returns {Promise<boolean>}
 */
async function api_exists(api_name) {
    return K8sApiClient.instance.probe_api_group(api_name);
}

/**
 * Discover NooBaa Service and OpenShift Route addresses for system_address.
 * @param {string} [app] - Kubernetes app label value (defaults to config.KUBE_APP_LABEL)
 * @returns {Promise<object[]>} Sorted address list (INTERNAL / EXTERNAL entries)
 */
async function discover_k8s_services(app = config.KUBE_APP_LABEL) {
    if (process.env.CONTAINER_PLATFORM !== 'KUBERNETES') {
        throw new Error('discover_k8s_services is only supported in kubernetes envs');
    }

    if (!app) {
        throw new Error(`Invalid app name, got: ${app}`);
    }


    let routes = [];
    try {
        routes = await _list_openshift_routes(`app=${app}`);
    } catch (err) {
        dbg.warn('discover_k8s_services: could not list OpenShift routes: ', err);
    }

    let services = [];
    try {
        const { items } = await list_resources('service', `app=${app}`);
        services = items;
    } catch (err) {
        dbg.warn('discover_k8s_services: could not list k8s services: ', err);
    }

    const list = _.flatMap(services, service_info => {
        const { metadata, spec = {}, status } = service_info;
        const { externalIPs = [] } = spec;
        const { ingress } = status.loadBalancer;
        const internal_hostname = `${metadata.name}.${metadata.namespace}.svc.cluster.local`;
        const external_hostnames = [
            ..._.flatMap(ingress, item => [item.ip, item.hostname].filter(Boolean)),
            ...externalIPs, // see: https://kubernetes.io/docs/concepts/services-networking/service/#external-ips
        ];

        const service_routes = routes
            .filter(route_info => {
                const { kind, name } = route_info.spec.to;
                return kind.toLowerCase() === 'service' && name === metadata.name;
            });

        return _.flatMap(spec.ports, port_info => {
            const routes_to_port = service_routes.filter(route_info =>
                route_info.spec.port.targetPort === port_info.name
            );

            const api = port_info.name
                .replace('-https', '')
                .replace(/-/g, '_');

            const defaults = {
                service: metadata.name,
                port: port_info.port,
                secure: port_info.name.endsWith('https'),
                api: api,
                weight: 0
            };

            return [{
                    ...defaults,
                    kind: 'INTERNAL',
                    hostname: internal_hostname,
                },
                ...external_hostnames.map(hostname => ({
                    ...defaults,
                    kind: 'EXTERNAL',
                    hostname,
                })),
                ...routes_to_port.map(route_info => ({
                    ...defaults,
                    kind: 'EXTERNAL',
                    hostname: route_info.spec.host,
                    port: route_info.spec.tls ? 443 : 80,
                    secure: Boolean(route_info.spec.tls),
                    weight: route_info.spec.to.weight
                }))
            ];
        });
    });

    return sort_address_list(list);
}

/**
 * List OpenShift Routes matching a label selector, or [] when the Route API is absent.
 * @param {string} selector - Kubernetes label selector
 * @returns {Promise<object[]>}
 */
async function _list_openshift_routes(selector) {
    const has_route_crd = await api_exists('route.openshift.io');
    if (!has_route_crd) {
        return [];
    }

    const { items } = await list_resources('route', selector);
    return items;
}

/**
 * Sort address entries for stable system_address comparison.
 * @param {object[]} address_list
 * @returns {object[]}
 */
function sort_address_list(address_list) {
    const sort_fields = ['kind', 'service', 'hostname', 'port', 'api', 'secure', 'weight'];
    return address_list.sort((item, other) => {
        const item_key = sort_fields.map(field => item[field]).join();
        const other_key = sort_fields.map(field => other[field]).join();
        return (
            (item_key < other_key && -1) ||
            (item_key > other_key && 1) ||
            0
        );
    });
}

exports.read_namespace = read_namespace;
exports.read_sa_token = read_sa_token;
exports.list_resources = list_resources;
exports.api_exists = api_exists;
exports.discover_k8s_services = discover_k8s_services;
