/* Copyright (C) 2016 NooBaa */

import template from './set-node-as-trusted-modal.html';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { retrustHost, closeModal } from 'action-creators';
import { action$ } from 'state';
import { timeShortFormat } from 'config';
import moment from 'moment';

const columns = deepFreeze([
    {
        name: 'testDate'
    },
    {
        name: 'drive'
    },
    {
        name: 'testType'
    },
    {
        name: 'results'
    }
]);

const eventMapping = deepFreeze({
    CORRUPTION: {
        type: 'Disk corruption',
        results: 'Data was changed'
    },
    TEMPERING: {
        type: 'Permission tampering',
        results: 'Directory permissions were changed'
    }
});

class SetNodeAsTrustedModalViewModel {
    constructor({ host, untrustedReasons }) {
        this.columns = columns;
        this.host = host;

        this.rows = flatMap(untrustedReasons,
            ({ drive, events }) => events.map(event => {
                const { time, reason } = event;
                const testDate = moment(time).format(timeShortFormat);
                const { type: testType, results } = eventMapping[reason];
                return { testDate, drive, testType, results };
            })
        );
    }

    onRetrust() {
        action$.next(retrustHost(this.host));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: SetNodeAsTrustedModalViewModel,
    template: template
};
