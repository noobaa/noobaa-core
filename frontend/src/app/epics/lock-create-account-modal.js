/* Copyright (C) 2016 NooBaa */

import { CREATE_ACCOUNT, } from 'action-types';
import { lockForm, lockModal } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(CREATE_ACCOUNT)
        .flatMap(() => [
            lockForm('createAccount'),
            lockModal()
        ]);
}
