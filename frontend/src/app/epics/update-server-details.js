/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { UPDATE_SERVER_DETAILS } from 'action-types';
import { completeUpdateServerDetails, failUpdateServerDetails } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_SERVER_DETAILS),
        mergeMap(async action => {
            const {
                secret,
                hostname,
                newHostname,
                locationTag
            } = action.payload;

            try {
                await api.cluster_server.update_server_conf({
                    target_secret: secret,
                    hostname: newHostname,
                    location: locationTag
                });

                return completeUpdateServerDetails(secret, hostname, newHostname);

            } catch (error) {
                return failUpdateServerDetails(secret, hostname, error);
            }
        })
    );
}
