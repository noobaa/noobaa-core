/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { EXPORT_AUDIT_LOG } from 'action-types';
import { completeExportAuditLog, failExportAuditLog } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(EXPORT_AUDIT_LOG),
        mergeMap(async action => {
            try {
                const { categories } = action.payload;
                const event = categories.length > 0 ?
                    categories.map(category => `(^${category}.)`).join('|') :
                    '^&';

                const logUri = await api.events.export_activity_log({ event });
                return completeExportAuditLog(logUri);

            } catch (error) {
                return failExportAuditLog(mapErrorObject(error));
            }
        })
    );
}
