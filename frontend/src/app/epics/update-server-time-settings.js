/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_SERVER_TIME_SETTINGS } from 'action-types';
import { completeUpdateServerTimeSettings, failUpdateServerTimeSettings } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_SERVER_TIME_SETTINGS),
        mergeMap(async action => {
            const {
                secret,
                hostname,
                timezone,
                epoch,
                ntpServer
            } = action.payload;

            try {
                if (ntpServer) {
                    await api.cluster_server.update_time_config({
                        target_secret: secret,
                        timezone,
                        ntp_server: ntpServer
                    });

                } else {
                    await api.cluster_server.update_time_config({
                        target_secret: secret,
                        timezone,
                        epoch
                    });
                }

                return completeUpdateServerTimeSettings(secret, hostname);

            } catch (error) {
                return failUpdateServerTimeSettings(
                    secret,
                    hostname,
                    mapErrorObject(error)
                );
            }
        })
    );
}
