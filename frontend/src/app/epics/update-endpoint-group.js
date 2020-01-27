/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_ENDPOINT_GROUP } from 'action-types';
import { completeUpdateEndpointGroup, failUpdateEndpointGroup } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_ENDPOINT_GROUP),
        mergeMap(async action => {
            const { name, endpointConf } = action.payload;

            try {
                await api.system.update_endpoint_group({
                    group_name: name,
                    endpoint_range: {
                        min: endpointConf.minCount,
                        max: endpointConf.maxCount
                    }
                });
                return completeUpdateEndpointGroup(name);

            } catch (error) {
                return failUpdateEndpointGroup(
                    name,
                    mapErrorObject(error)
                );
            }
        })
    );
}

