/* Copyright (C) 2016 NooBaa */

import { FAIL_CREATE_ACCOUNT } from 'action-types';
import { closeModal } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(FAIL_CREATE_ACCOUNT)
        .map(() => closeModal());
}
