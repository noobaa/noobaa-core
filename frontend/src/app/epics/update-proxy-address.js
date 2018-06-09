/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_PROXY_ADDRESS } from 'action-types';
import { completeUpdateProxyAddress, failUpdateProxyAddress } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_PROXY_ADDRESS),
        mergeMap(async action => {
            const { enabled, address, port } = action.payload;
            const proxyAddress = enabled ? `http://${address}:${port}` : null;

            try {
                await api.system.update_proxy_address({
                    address: proxyAddress
                });

                return completeUpdateProxyAddress();
            } catch (error) {
                return failUpdateProxyAddress(
                    mapErrorObject(error)
                );
            }
        })
    );
}
