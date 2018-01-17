/* Copyright (C) 2016 NooBaa */

import template from './bucket-cloud-sync-form.html';
import Observer from 'observer';
import ko from 'knockout';
import moment from 'moment';
import { stringifyAmount } from 'utils/string-utils';
import { state$, action$ } from 'state';
import { timeShortFormat } from 'config';
import {
    openSetCloudSyncModal,
    openEditCloudSyncModal,
    deleteCloudSyncPolicy,
    toggleCloudSyncPolicy
} from 'action-creators';

const syncStateMapping = Object.freeze({
    PENDING: 'Waiting for sync',
    SYNCING: 'Syncing',
    UNABLE: 'Unable to sync',
    SYNCED: 'Sync completed'
});

const directionMapping = Object.freeze({
    SOURCE_TO_TARGET: 'Source to target',
    TARGET_TO_SOURCE: 'Target to source',
    BI_DIRECTIONAL: 'Bi directional'
});

function _formatFrequency(lastSyncTime, value, unit) {
    return moment(lastSyncTime)
        .add(value, unit)
        .format(timeShortFormat);
}

class BucketCloudSyncFormViewModel extends Observer {
    bucketName = '';
    isBucketLoaded = ko.observable();
    hasCloudSync = ko.observable();
    toggleSyncButtonLabel = ko.observable();
    isPaused = ko.observable();
    statusDetails = [
        {
            label: 'Sync Status',
            value: ko.observable()
        },
        {
            label: 'Last sync',
            value: ko.observable()
        },
        {
            label: 'Next Scheduled Sync',
            value: ko.observable(),
            template: 'nextScheduledSync'
        }
    ];
    connectionDetails = [
        {
            label: 'Endpoint',
            value: ko.observable()
        },
        {
            label: 'Access key',
            value: ko.observable()
        },
        {
            label: 'Target bucket',
            value: ko.observable()
        }
    ];
    syncPolicy = [
        {
            label: 'Frequency',
            value: ko.observable()
        },
        {
            label: 'Direction',
            value: ko.observable()
        },
        {
            label: 'Sync Deletions',
            value: ko.observable()
        }
    ];


    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(state$.get('buckets', this.bucketName), this.onState);
    }

    onState(bucket) {
        if (!bucket) {
            this.isBucketLoaded(false);
            return;
        }

        this.hasCloudSync(Boolean(bucket.cloudSync));
        this.isBucketLoaded(true);
        
        if (!bucket.cloudSync) {
            this.isPaused(undefined);
        } else {
            const { state , policy } = bucket.cloudSync;
            const { value, unit } = policy.frequency;
            const isPausedLabel = `${state.isPaused ?  'Resume' : 'Pause'} Schedule`;
            const lastSync = true &&
                (!state.lastSyncTime && 'No previous sync') ||
                moment(state.lastSyncTime).format(timeShortFormat);
            const nextSyncValue = true &&
                (state.isPaused && 'Paused by user') ||
                (!state.status === 'PENDING' && 'In a few moments') ||
                _formatFrequency(state.lastSyncTime, value, unit);

            const nextSyncCss = state.isPaused ? 'warning' : '';
            const nextSync = {
                value: nextSyncValue,
                css: nextSyncCss
            };

            this.isPaused(state.isPaused);
            this.toggleSyncButtonLabel(isPausedLabel);
            this.statusDetails[0].value(syncStateMapping[state.mode]);
            this.statusDetails[1].value(lastSync);
            this.statusDetails[2].value(nextSync);
            this.connectionDetails[0].value(policy.endpoint);
            this.connectionDetails[1].value(policy.accessKey);
            this.connectionDetails[2].value(policy.targetBucket);
            this.syncPolicy[0].value(`Every ${stringifyAmount(unit.toLowerCase(), value)}`);
            this.syncPolicy[1].value(directionMapping[policy.direction]);
            this.syncPolicy[2].value(policy.syncDeletions ? 'Yes' : 'No');
        }
    }

    onSetPolicy() {
        action$.onNext(openSetCloudSyncModal(this.bucketName));
    }

    onEditPolicy() {
        action$.onNext(openEditCloudSyncModal(this.bucketName));
    }

    onRemovePolicy() {
        action$.onNext(deleteCloudSyncPolicy(this.bucketName));
    }

    onToggleSync() {
        if (this.hasCloudSync()) {
            action$.onNext(toggleCloudSyncPolicy(this.bucketName, !this.isPaused()));
        }
    }
}

export default {
    viewModel: BucketCloudSyncFormViewModel,
    template: template
};
