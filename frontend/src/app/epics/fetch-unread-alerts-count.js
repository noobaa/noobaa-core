/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_UNREAD_ALERTS_COUNT } from 'action-types';
import { completeFetchUnreadAlertsCount, failFetchUnreadAlertsCount } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_UNREAD_ALERTS_COUNT),
        mergeMap(async () => {
            try {
                const { CRIT, MAJOR, INFO } = await api.events.get_unread_alerts_count();
                return completeFetchUnreadAlertsCount(CRIT, MAJOR, INFO);

            } catch (error) {
                return failFetchUnreadAlertsCount(mapErrorObject(error));
            }
        })
    );
}
