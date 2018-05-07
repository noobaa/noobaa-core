/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_NODE_INSTALLATION_COMMANDS } from 'action-types';
import {
    completeFetchNodeInstallationCommands,
    failFetchNodeInstallationCommands
} from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_NODE_INSTALLATION_COMMANDS),
        mergeMap(async action => {
            const { targetPool, excludedDrives } = action.payload;

            try {
                const commands = await api.system.get_node_installation_string({
                    pool: targetPool,
                    exclude_drives: excludedDrives
                });

                return completeFetchNodeInstallationCommands(targetPool, excludedDrives, commands);

            } catch (error) {
                return failFetchNodeInstallationCommands(mapErrorObject(error));
            }
        })
    );
}
