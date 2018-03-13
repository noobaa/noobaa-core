/* Copyright (C) 2016 NooBaa */

import { CHANGE_LOCATION } from 'action-types';
import { closeModal } from 'action-creators';

export default function(action$) {
    return action$
        .ofType(CHANGE_LOCATION)
        .map(() => closeModal(Number.POSITIVE_INFINITY));
}
