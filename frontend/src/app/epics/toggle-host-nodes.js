/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { TOGGLE_HOST_NODES } from 'action-types';
import { completeToggleHostNodes, failToggleHostNodes } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(TOGGLE_HOST_NODES)
        .flatMap(async action => {
            const { host, nodes } = action.payload;

            try {
                const nodeList = Object.entries(nodes)
                    .map(pair => {
                        const [ name, enabled ] = pair;
                        return { name, enabled };
                    });

                await api.host.update_host_services({
                    name: host,
                    nodes: nodeList
                });

                return completeToggleHostNodes(host);

            } catch (error) {
                return failToggleHostNodes(
                    host,
                    mapErrorObject(error)
                );
            }
        });
}
