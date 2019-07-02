/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { CREATE_HOSTS_POOL } from 'action-types';
import { completeCreateHostsPool, failCreateHostsPool } from 'action-creators';

export default function(action$, { api, browser }) {
    return action$.pipe(
        ofType(CREATE_HOSTS_POOL),
        mergeMap(async action => {
            const { name, hostCount, hostVolumeSize, isManaged } = action.payload;

            try {
                const deployYAML = await api.pool.create_hosts_pool({
                    name: name,
                    is_managed: isManaged,
                    host_count: hostCount,
                    host_config: {
                        volume_size: hostVolumeSize
                    }
                });

                const deployYAMLUri = browser.toObjectUrl(deployYAML);
                return completeCreateHostsPool(name, deployYAMLUri, !isManaged);

            } catch (error) {
                return failCreateHostsPool(
                    name,
                    mapErrorObject(error)
                );
            }
        })
    );
}

