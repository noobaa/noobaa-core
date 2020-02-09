/* Copyright (C) 2016 NooBaa */

import {
    GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
    COMPLETE_GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
    FAIL_GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
    UPDATE_ENDPOINT_GROUP,
    COMPLETE_UPDATE_ENDPOINT_GROUP,
    FAIL__UPDATE_ENDPOINT_GROUP
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
        type: FAIL__UPDATE_ENDPOINT_GROUP,
        payload: {
            name,
            error
        }
    };
}
