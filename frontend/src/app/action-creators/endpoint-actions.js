/* Copyright (C) 2016 NooBaa */

import {
    GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
    COMPLETE_GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
    FAIL_GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
    UPDATE_ENDPOINT_GROUP,
    COMPLETE_UPDATE_ENDPOINT_GROUP,
    FAIL_UPDATE_ENDPOINT_GROUP,
    FETCH_ENDPOINTS_HISTORY,
    COMPLETE_FETCH_ENDPOINTS_HISTORY,
    FAIL_FETCH_ENDPOINTS_HISTORY,
    DROP_ENDPOINTS_HISTORY
} from 'action-types';

export function generateEndpointGroupDeploymentYAML(region, endpointConf) {
    return {
        type: GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
        payload: { region, endpointConf }
    };
}

export function completeGenerateEndpointGroupDeploymentYAML(deployYAMLUri) {
    return {
        type: COMPLETE_GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
        payload: {
            deployYAMLUri
        }
    };
}

export function failGenerateEndpointGroupDeploymentYAML(error) {
    return {
        type: FAIL_GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
        payload: { error }
    };
}

export function updateEndpointGroup(name, region, endpointConf) {
    return {
        type: UPDATE_ENDPOINT_GROUP,
        payload: {
            name,
            region,
            endpointConf
        }
    };
}

export function completeUpdateEndpointGroup(name) {
    return {
        type: COMPLETE_UPDATE_ENDPOINT_GROUP,
        payload: { name }
    };
}

export function failUpdateEndpointGroup(name, error) {
    return {
        type: FAIL_UPDATE_ENDPOINT_GROUP,
        payload: {
            name,
            error
        }
    };
}

export function fetchEndpointsHistory(groups, timespan) {
    return {
        type: FETCH_ENDPOINTS_HISTORY,
        payload: {
            timestamp: Date.now(),
            groups,
            timespan
        }
    };
}

export function completeFetchEndpointsHistory(query, history) {
    return {
        type: COMPLETE_FETCH_ENDPOINTS_HISTORY,
        payload: { query, history }
    };
}

export function failFetchEndpointsHistory(query, error) {
    return {
        type: FAIL_FETCH_ENDPOINTS_HISTORY,
        payload: { query, error}
    };
}

export function dropEndpointsHistory() {
    return {
        type: DROP_ENDPOINTS_HISTORY,
        payload: {}
    };
}

