/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { ATTACH_SERVER_TO_CLUSTER } from 'action-types';
import { completeAttachServerToCluster, failAttachServerToCluster } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(ATTACH_SERVER_TO_CLUSTER),
        mergeMap(async action => {
            const {
                secret,
                address,
                hostname,
                location
            } = action.payload;

            try {
                await api.cluster_server.add_member_to_cluster({
                    address,
                    secret,
                    role: 'REPLICA',
                    shard: 'shard1',
                    location: location,
                    new_hostname: hostname
                });
                return completeAttachServerToCluster(secret, hostname);
            } catch (error) {
                return failAttachServerToCluster(secret, hostname, error);
            }
        })
    );
}
