/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_PROXY_SERVER_SETTINGS } from 'action-types';
import {
    completeUpdateProxyServerSettings,
    failUpdateProxyServerSettings
} from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_PROXY_SERVER_SETTINGS),
        mergeMap(async action => {
            const { address } = action.payload;
            const proxyAddress = address ?
                `http://${address.endpoint}:${address.port}` :
                null;

            try {
                await api.system.update_phone_home_config({ proxy_address: proxyAddress });
                return completeUpdateProxyServerSettings();

            } catch (error) {
                return failUpdateProxyServerSettings(
                    mapErrorObject(error)
                );
            }
        })
    );
}
