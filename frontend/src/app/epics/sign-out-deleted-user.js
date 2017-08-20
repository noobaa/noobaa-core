/* Copyright (C) 2017 NooBaa */

import { COMPLETE_DELETE_ACCOUNT } from 'action-types';
import { signOut } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(COMPLETE_DELETE_ACCOUNT)
        .map(action => {
            const { isCurrentUser } = action.payload;

            if (isCurrentUser) {
                return signOut();
            }
        });
}
