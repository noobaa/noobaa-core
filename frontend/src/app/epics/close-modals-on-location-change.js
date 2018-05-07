/* Copyright (C) 2016 NooBaa */

import { map } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { CHANGE_LOCATION } from 'action-types';
import { closeModal } from 'action-creators';

export default function(action$) {
    return action$.pipe(
        ofType(CHANGE_LOCATION),
        map(() => closeModal(Number.POSITIVE_INFINITY))
    );
}
