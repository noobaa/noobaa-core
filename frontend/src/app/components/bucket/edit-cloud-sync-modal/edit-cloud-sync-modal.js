import template from './edit-cloud-sync-modal.html';
import ko from 'knockout';
import { cloudSyncInfo } from 'model';
import { loadCloudSyncInfo } from 'actions';
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

class EditCloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
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
            () => policy() && policy().schedule < DAY ?
                (policy().schedule < HOUR ? MIN : HOUR) :
                DAY
        );

        this.frequency = ko.observableWithDefault(
            () => policy() && (policy().schedule / this.frequencyUnit())
        );

        this.frequencyUnitOptions = frequencyUnitOptions;

        this.direction = ko.observableWithDefault(
            () => policy() && bitsToNumber(policy().n2c_enabled, policy().c2n_enabled)
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
        this.onClose();
    }
}

export default {
    viewModel: EditCloudSyncModalViewModel,
    template: template
};
