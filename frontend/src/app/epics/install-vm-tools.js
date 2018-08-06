/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { INSTALL_VM_TOOLS } from 'action-types';
import { completeInstallVMTools, failInstallVMTools } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(INSTALL_VM_TOOLS),
        mergeMap(async () => {
            try {
                await api.cluster_server.install_vmtools({});
                return completeInstallVMTools();

            } catch (error) {
                return failInstallVMTools(mapErrorObject(error));
            }
        })
    );
}
