/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_REMOTE_SYSLOG } from 'action-types';
import { completeUpdateRemoteSyslog, failUpdateRemoteSyslog } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_REMOTE_SYSLOG)
        .flatMap(async action => {
            const { enabled } = action.payload;
            try {

                await api.system.configure_remote_syslog({
                    enabled,
                    protocol: enabled ? action.payload.protocol : undefined,
                    address: enabled ? action.payload.address : undefined,
                    port: enabled ? action.payload.port : undefined
                });

                return completeUpdateRemoteSyslog(enabled);
            } catch (error) {
                return failUpdateRemoteSyslog(
                    enabled,
                    mapErrorObject(error)
                );
            }
        });
}
