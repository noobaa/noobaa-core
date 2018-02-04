/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { COLLECT_HOST_DIAGNOSTICS } from 'action-types';
import { completeCollectHostDiagnostics, failCollectHostDiagnostics } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(COLLECT_HOST_DIAGNOSTICS)
        .flatMap(async action => {
            const { host } = action.payload;

            try {
                const packageUri = await api.host.diagnose_host({ name: host });
                return completeCollectHostDiagnostics(host, packageUri);

            } catch (error) {
                return failCollectHostDiagnostics(
                    host,
                    mapErrorObject(error)
                );
            }
        });
}
