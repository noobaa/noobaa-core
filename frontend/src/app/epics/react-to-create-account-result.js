/* Copyright (C) 2016 NooBaa */

import { from } from 'rxjs';
import { mergeMap, take, map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { openAccountCreatedModal, closeModal } from 'action-creators';
import {
    COMPLETE_CREATE_ACCOUNT,
    COMPLETE_FETCH_SYSTEM_INFO,
    FAIL_CREATE_ACCOUNT
} from 'action-types';

function _replaceModalAfterSuccess(action$) {
    return action$.pipe(
        ofType(COMPLETE_CREATE_ACCOUNT),
        mergeMap(action => {
            const { accountName, password } = action.payload;
            return action$.pipe(
                ofType(COMPLETE_FETCH_SYSTEM_INFO),
                take(1),
                mergeMap(() => [
                    closeModal(),
                    openAccountCreatedModal(accountName, password)
                ])
            );
        })
    );
}

function _closeModalAfterFaliure(action$) {
    return action$.pipe(
        ofType(FAIL_CREATE_ACCOUNT),
        map(() => closeModal())
    );
}


export default function(action$) {
    return from([
        _replaceModalAfterSuccess,
        _closeModalAfterFaliure
    ]).pipe(mergeMap(epic => epic(action$)));

}

