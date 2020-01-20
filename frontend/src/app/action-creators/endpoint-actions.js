/* Copyright (C) 2016 NooBaa */

import {
    GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
    COMPLETE_GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
    FAIL_GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML
} from 'action-types';

export function generateEndpointGroupDeploymentYAML(endpointConf) {
    return {
        type: GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML,
        payload: { endpointConf }
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
