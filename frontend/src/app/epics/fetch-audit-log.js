/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_AUDIT_LOG } from 'action-types';
import { completeFetchAuditLog, failFetchAuditLog } from 'action-creators';
import { sleep } from 'utils/promise-utils';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_AUDIT_LOG),
        mergeMap(async action => {
            await sleep(1000);
            const { query, limit, till } = action.payload;

            try {
                const { categories } = query;
                const event = categories.length > 0 ?
                    categories.map(category => `(^${category}.)`).join('|') :
                    '^&';

                const { logs: list } = await api.events.read_activity_log({ event, limit, till });
                return completeFetchAuditLog(limit, list);

            } catch (error) {
                return failFetchAuditLog(mapErrorObject(error));
            }
        })
    );
}
