/* Copyright (C) 2017 NooBaa */

import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { COMPLETE_DELETE_ACCOUNT } from 'action-types';
import { signOut } from 'action-creators';

export default function(action$) {
    return action$.pipe(
        ofType(COMPLETE_DELETE_ACCOUNT),
        map(action => {
            const { isCurrentUser } = action.payload;

            if (isCurrentUser) {
                return signOut();
            }
        })
    );
}
