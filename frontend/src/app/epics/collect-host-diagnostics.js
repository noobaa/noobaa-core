/* Copyright (C) 2016 NooBaa */

import { COLLECT_HOST_DIAGNOSTICS } from 'action-types';
import { completeCollectHostDiagnostics, failCollectHostDiagnostics } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(COLLECT_HOST_DIAGNOSTICS)
        .flatMap(async action => {
            const { host } = action.payload;

            try {
                const packageUri = await api.host.diagnose_host({ host_id: host });
                return completeCollectHostDiagnostics(host, packageUri);

            } catch (error) {
                return failCollectHostDiagnostics(host, error);
            }
        });
}
