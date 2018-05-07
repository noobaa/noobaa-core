/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_SERVER_ADDRESS } from 'action-types';
import { completeUpdateServerAddress, failUpdateServerAddress } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_SERVER_ADDRESS),
        mergeMap(async action => {
            const { newAddress, secret, hostname } = action.payload;

            try {
                await api.cluster_server.update_member_of_cluster({
                    new_address: newAddress,
                    target_secret: secret
                });
                return completeUpdateServerAddress(secret, hostname);

            } catch (error) {
                return failUpdateServerAddress(
                    secret,
                    hostname,
                    mapErrorObject(error)
                );
            }
        })
    );
}
