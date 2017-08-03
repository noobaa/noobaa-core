/* Copyright (C) 2016 NooBaa */

import { COLLECT_HOST_DIAGNOSTICS } from 'action-types';
import { completeCollectHostDiagnostics, failCollectHostDiagnostics } from 'action-creators';
import { sleep } from 'utils/promise-utils';

export default function(action$, { api }) {
    return action$
        .ofType(COLLECT_HOST_DIAGNOSTICS)
        .flatMap(async action => {
            const { host } = action.payload;

            try {
                await sleep(7000);
                const packageUri = await api.system.diagnose_node({ host });
                return completeCollectHostDiagnostics(host, packageUri);

            } catch (error) {
                return failCollectHostDiagnostics(host, error);
            }
        });
}
