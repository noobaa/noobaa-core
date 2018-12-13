/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_P2P_SETTINGS } from 'action-types';
import { completeUpdateP2PSettings, failUpdateP2PSettings } from 'action-creators';

function _buildConfigObj(start, end) {
    if (start === end) {
        return {
            tcp_permanent_passive: {
                port: start
            }
        };

    } else {
        return {
            tcp_permanent_passive: {
                min: start,
                max: end
            }
        };
    }
}

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_P2P_SETTINGS),
        mergeMap(async action => {
            const { start, end } = action.payload.tcpPortRange;
            try {
                await api.system.update_n2n_config({
                    config: _buildConfigObj(start, end)
                });
                return completeUpdateP2PSettings();

            } catch (error) {
                return failUpdateP2PSettings(mapErrorObject(error));
            }
        })
    );
}
