/* Copyright (C) 2016 NooBaa */

import { COMPLETE_CREATE_ACCOUNT, COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';
import { replaceWithAccountCreatedModal } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(COMPLETE_CREATE_ACCOUNT)
        .flatMap(action => {
            const { accountName, password } = action.payload;
            return action$
                .ofType(COMPLETE_FETCH_SYSTEM_INFO)
                .take(1)
                .map(() => replaceWithAccountCreatedModal(accountName, password));
        });
}
