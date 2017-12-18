/* Copyright (C) 2016 NooBaa */

import template from './edit-cloud-sync-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateCloudSyncPolicy } from 'actions';
import { deepFreeze, bitsToNumber } from 'utils/core-utils';

const [ MIN, HOUR, DAY ] = [ 1, 60, 60 * 24 ];
const frequencyUnitOptions = deepFreeze([
    {
        value: MIN,
        label: 'Minutes'
    },
    {
        value: HOUR,
        label: 'Hours'
    },
    {
        value: DAY,
        label: 'Days'
    }
]);

const directions = deepFreeze([
    {
        value: 3,
        label: 'Bi-Direcitonal',
        leftSymbol: 'arrow-left',
        rightSymbol: 'arrow-right'
    },
    {
        value: 1,
        label: 'Source to Target',
        leftSymbol: 'arrow-line',
        rightSymbol: 'arrow-right'
    },
    {
        value: 2,
        label: 'Target to Source',
        leftSymbol: 'arrow-left',
        rightSymbol: 'arrow-line'
    }
]);

function minutesToUnit(minutes) {
    return minutes % DAY === 0 ? DAY : (minutes % HOUR === 0 ? HOUR : MIN);
}

class EditCloudSyncModalViewModel extends BaseViewModel {
    constructor({ bucketName, onClose }) {
        super();

        this.onClose = onClose;

        this.sourceBucket = bucketName;

        const cloudSyncInfo = ko.pureComputed(
            () => systemInfo().buckets
                .find(
                    bucket => bucket.name === ko.unwrap(bucketName)
                )
                .cloud_sync
        );

        const policy = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().policy
        );

        this.endpoint = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().endpoint
        );

        this.targetBucket = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().target_bucket
        );

        this.frequencyUnit = ko.observableWithDefault(
            () => policy() && minutesToUnit(policy().schedule_min)
        );

        this.frequency = ko.observableWithDefault(
            () => policy() && (
                policy().schedule_min / minutesToUnit(policy().schedule_min)
            )
        )
            .extend({
                required: { message: 'Please enter a value greater than or equal to 1' },
                min: 1
            });

        this.frequencyUnitOptions = frequencyUnitOptions;

        this.direction = ko.observableWithDefault(
            () => policy() && bitsToNumber(policy().c2n_enabled, policy().n2c_enabled)
        );

        this.directionOption = ko.pureComputed(
            () => this.direction() && directions
                .find(
                    dir => dir.value === this.direction()
                )
        );

        this.leftSymbol = ko.pureComputed(
            () => this.directionOption().leftSymbol
        );

        this.rightSymbol = ko.pureComputed(
            () => this.directionOption().rightSymbol
        );

        this.directionOptions = directions;

        const _syncDeletions = ko.observableWithDefault(
            () => policy() && !policy().additions_only
        );

        this.syncDeletions = ko.pureComputed({
            read: () => this.direction() === 3 ? true : _syncDeletions(),
            write: _syncDeletions
        });

        this.errors = ko.validation.group(this);
    }

    cancel() {
        this.onClose();
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            updateCloudSyncPolicy(
                ko.unwrap(this.sourceBucket),
                this.direction(),
                this.frequency() * this.frequencyUnit(),
                this.syncDeletions()
            );
            this.onClose();
        }
    }
}

export default {
    viewModel: EditCloudSyncModalViewModel,
    template: template
};
