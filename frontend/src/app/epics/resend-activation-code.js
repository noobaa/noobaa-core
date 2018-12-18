/* Copyright (C) 2016 NooBaa */

import { empty } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { RESEND_ACTIVATION_CODE } from 'action-types';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(RESEND_ACTIVATION_CODE),
        mergeMap(action => {
            const { email } = action.payload;
            api.system.resend_activation_code({ email });
            return empty();
        })
    );
}
