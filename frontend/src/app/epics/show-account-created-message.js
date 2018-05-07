/* Copyright (C) 2016 NooBaa */

import { mergeMap, take, map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { COMPLETE_CREATE_ACCOUNT, COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';
import { replaceWithAccountCreatedModal } from 'action-creators';

export default function(action$) {
    return action$.pipe(
        ofType(COMPLETE_CREATE_ACCOUNT),
        mergeMap(action => {
            const { accountName, password } = action.payload;
            return action$.pipe(
                ofType(COMPLETE_FETCH_SYSTEM_INFO),
                take(1),
                map(() => replaceWithAccountCreatedModal(accountName, password))
            );
        })
    );
}
