/* Copyright (C) 2016 NooBaa */

import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS } from 'action-types';
import { updateForm } from 'action-creators';

export default function(action$) {
    return action$.pipe(
        ofType(COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS),
        map(action => {
            const command = action.payload.commands['KUBERNETES'];
            return updateForm('InstallNodeModalViewModel', { command });
        })
    );
}
