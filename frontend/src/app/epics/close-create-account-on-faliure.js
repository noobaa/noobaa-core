/* Copyright (C) 2016 NooBaa */

import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { FAIL_CREATE_ACCOUNT } from 'action-types';
import { closeModal } from 'action-creators';

export default function(action$) {
    return action$.pipe(
        ofType(FAIL_CREATE_ACCOUNT),
        map(() => closeModal())
    );
}
