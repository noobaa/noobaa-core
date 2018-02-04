/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { FETCH_NODE_INSTALLATION_COMMANDS } from 'action-types';
import {
    completeFetchNodeInstallationCommands,
    failFetchNodeInstallationCommands
} from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_NODE_INSTALLATION_COMMANDS)
        .flatMap(async action => {
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
        });
}
