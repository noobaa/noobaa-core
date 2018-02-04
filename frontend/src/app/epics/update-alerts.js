/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_ALERTS } from 'action-types';
import { completeUpdateAlerts, failUpdateAlerts } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(UPDATE_ALERTS)
        .flatMap(async action => {
            const { query, read } = action.payload;

            try {
                await api.events.update_alerts_state({ query, state: read });
                return completeUpdateAlerts(query, read);

            } catch (error) {
                return failUpdateAlerts(
                    query,
                    read,
                    mapErrorObject(error)
                );
            }
        });
}
