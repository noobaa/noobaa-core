/* Copyright (C) 2016 NooBaa */

import template from './bucket-placement-policy-modal.html';
import editScreenTemplate from './edit-screen.html';
import warningScreenTemplate from './warn-screen.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { deepFreeze, noop, keyByProperty } from 'utils/core-utils';
import { systemInfo } from 'model';
import { updateBucketPlacementPolicy } from 'actions';
import { action$ } from 'state';
import { updateModal } from 'action-creators';

const screenModalMetaMapping = deepFreeze({
    0: {
        title: 'Bucket Data Placement Policy',
        size: 'large',
        severity: ''
    },
    1: {
        title: 'Empty Data Placement Policy',
        size: 'xsmall',
        severity: 'warning'
    }
});

const allowedResourceTypes = deepFreeze([
    'HOSTS',
    'CLOUD'
]);

class BacketPlacementPolicyModalViewModel extends BaseViewModel {
    constructor({ bucketName, onClose = noop }) {
        super();

        this.onClose = onClose;
        this.editScreenTemplate = editScreenTemplate;
        this.warningScreenTemplate = warningScreenTemplate;

        this.screen = ko.observable(0);
        this.screen.subscribe(
            screen => action$.onNext(updateModal(screenModalMetaMapping[screen]))
        );

        this.tierName = ko.pureComputed(
            () => {
                if(!systemInfo()) {
                    return '';
                }

                let bucket = systemInfo().buckets.find(
                    bucket => bucket.name === ko.unwrap(bucketName)
                );

                return bucket.tiering.tiers[0].tier;
            }
        );

        this.tier = ko.pureComputed(
            () => {
                if (!this.tierName()) {
                    return;
                }

                return systemInfo().tiers.find(
                    ({ name }) =>  this.tierName() === name
                );
            }
        );

        this.placementType = ko.observableWithDefault(
            () => this.tier() && this.tier().data_placement
        );

        this.pools = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : [])
                .filter(pool => allowedResourceTypes.includes(pool.resource_type))
        );

        this.selectedPools = ko.observableArray(
            Array.from(this.tier().attached_pools)
        ).extend({
            validation: {
                validator: selected => {
                    return this.placementType() !== 'MIRROR' || selected.length !== 1;
                },
                message: 'Mirror policy requires at least 2 participating pools'
            }
        });

        const poolsByName = ko.pureComputed(
            () => keyByProperty(this.pools(), 'name')
        );

        this.isWarningVisible = ko.pureComputed(
            () => {
                if (this.placementType() === 'MIRROR') {
                    return false;
                }

                const selectedPools = this.selectedPools();
                const hasNodesPool = selectedPools.some(
                    name => poolsByName()[name].resource_type === 'HOSTS'
                );
                const hasCloudResource = selectedPools.some(
                    name => poolsByName()[name].resource_type === 'CLOUD'
                );

                return hasNodesPool && hasCloudResource;
            }
        );

        this.errors = ko.validation.group(this);
    }

    onResourcesLink() {
        this.onClose();
    }

    backToEdit() {
        this.screen(0);
    }

    beforeSave() {
        if (this.selectedPools().length === 0) {
            this.screen(1);
        } else {
            this.save();
        }
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            updateBucketPlacementPolicy(
                this.tierName(),
                this.placementType(),
                this.selectedPools()
            );

            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: BacketPlacementPolicyModalViewModel,
    template: template
};
