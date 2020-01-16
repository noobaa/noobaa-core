/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML } from 'action-types';
import {
    completeGenerateEndpointGroupDeploymentYAML,
    failGenerateEndpointGroupDeploymentYAML
} from 'action-creators';

export default function(action$, { api, browser }) {
    return action$.pipe(
        ofType(GENERATE_ENDPOINT_GROUP_DEPLOYMENT_YAML),
        mergeMap(async action => {
            const { endpointConf } = action.payload;

            try {
                const yaml = await api.system.get_join_cluster_yaml({
                    endpoints: {
                        min_count: endpointConf.minCount,
                        max_count: endpointConf.maxCount
                    }
                });

                const yamlUri = browser.toObjectUrl(yaml, 'text/yaml');
                return completeGenerateEndpointGroupDeploymentYAML(yamlUri);

            } catch (error) {
                return failGenerateEndpointGroupDeploymentYAML(
                    mapErrorObject(error)
                );
            }
        })
    );
}
