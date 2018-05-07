/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { TOGGLE_HOST_SERVICES } from 'action-types';
import { completeToggleHostServices, failToggleHostServices } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(TOGGLE_HOST_SERVICES),
        mergeMap(async action => {
            const { host, services } = action.payload;

            try {
                await api.host.update_host_services({
                    name: host,
                    services: {
                        storage: services.storage,
                        s3: services.endpoint
                    }
                });

                return completeToggleHostServices(host, services);

            } catch (error) {
                return failToggleHostServices(
                    host,
                    services,
                    mapErrorObject(error)
                );
            }
        })
    );
}
