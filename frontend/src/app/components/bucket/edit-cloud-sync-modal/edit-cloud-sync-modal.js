import template from './edit-cloud-sync-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { cloudSyncInfo } from 'model';
import { loadCloudSyncInfo, updateCloudSyncPolicy } from 'actions';
import { deepFreeze, bitsToNumber } from 'utils';

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

const directionMapping = deepFreeze({
    1: { label: 'Source to target', symbol: '--->' },
    2: { label: 'Target to source', symbol: '<---' },
    3: { label: 'Bi directional', symbol: '<-->' }
});

function minutesToUnit(minutes) {
    return minutes % DAY === 0 ? DAY : (minutes % HOUR === 0 ? HOUR : MIN);
}

class EditCloudSyncModalViewModel extends Disposable {
    constructor({ bucketName, onClose }) {
        super();

        this.onClose = onClose;

        this.sourceBucket = bucketName;

        let policy = ko.pureComputed(
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
        );

        this.frequencyUnitOptions = frequencyUnitOptions;

        this.direction = ko.observableWithDefault(
            () => policy() && bitsToNumber(policy().c2n_enabled, policy().n2c_enabled)
        );

        this.directionSymbol = ko.pureComputed(
            () => this.direction() && directionMapping[this.direction()].symbol
        );

        this.directionOptions = Object.keys(directionMapping).map(
            key => ({
                value: Number(key),
                label: directionMapping[key].label
            })
        );

        let _syncDeletions = ko.observableWithDefault(
            () => policy() && !policy().additions_only
        );

        this.syncDeletions = ko.pureComputed({
            read: () => this.direction() === 3 ? true : _syncDeletions(),
            write: _syncDeletions
        });

        loadCloudSyncInfo(ko.unwrap(bucketName));
    }

    cancel() {
        this.onClose();
    }

    save() {
        updateCloudSyncPolicy(
            ko.unwrap(this.sourceBucket),
            this.direction(),
            this.frequency() * this.frequencyUnit(),
            this.syncDeletions()
        );
        this.onClose();
    }
}

export default {
    viewModel: EditCloudSyncModalViewModel,
    template: template
};
