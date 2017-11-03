/* Copyright (C) 2016 NooBaa */

import template from './set-node-as-trusted-modal.html';
import Observer from 'observer';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { retrustHost } from 'action-creators';
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
        type: 'Node tempering',
        results: 'missing data'
    }
});

class SetNodeAsTrustedModalViewModel extends Observer {
    constructor({ onClose, host, untrustedReasons }) {
        super();

        this.columns = columns;
        this.close = onClose;
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
        action$.onNext(retrustHost(this.host));
        this.close();
    }

    onCancel() {
        this.close();
    }
}

export default {
    viewModel: SetNodeAsTrustedModalViewModel,
    template: template
};
