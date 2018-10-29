/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-placement-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { usingInternalStorageWarningTooltip } from 'knowledge-base-articles.json';
import { formatSize } from 'utils/size-utils';

const addTierTooltips = deepFreeze({
    usingInternal: 'Adding more tiers will be enabled after adding storage resources to the system',
    hasMaxTiers: 'Adding more tiers will be available in the following versions of NooBaa'
});

const internalWarningTooltip = deepFreeze({
    template: 'textAndLink',
    text: {
        text:`
            Using the system internal storage is not recommended due to low performance.
            Please add storage resources(on-premise nodes or cloud resources).
        `,
        link: {
            text: 'Learn how to add storage to NooBaa',
            href: usingInternalStorageWarningTooltip
        }
    }
});

class BucketDataPlacementFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    bucketName = ko.observable();
    tierNames = ko.observableArray();
    isAddTierDisabled = ko.observable();
    addTierTooltip = ko.observable();
    isInternalWarningVisible = ko.observable();
    internalWarningTooltip = internalWarningTooltip;
    internalStorageUsage = ko.observable();

    selectState(state, params) {
        const { buckets } = state;
        return [
            params.bucketName,
            buckets && buckets[params.bucketName].placement2
        ];
    }

    mapStateToProps(bucketName, placement) {
        if (!placement) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {

            const { tiers } = placement;
            const isUsingInternalStorage = tiers[0].policyType === 'INTERNAL_STORAGE';
            const isAddTierDisabled = isUsingInternalStorage;
            const tierNames = placement.tiers.map(tier => tier.name);
            const addTierTooltip = {
                text:
                    (isUsingInternalStorage && addTierTooltips.usingInternal) ||
                    (tierNames.length === 2 && addTierTooltips.hasMaxTiers) ||
                    '',
                align: 'end'
            };
            const internalStorageUsage = `${
                formatSize(3 * (1024 ** 3))
            } of ${
                formatSize(320 * (1024 ** 3))
            }`;


            ko.assignToProps(this, {
                dataReady: true,
                bucketName,
                tierNames,
                isInternalWarningVisible: isUsingInternalStorage,
                isAddTierDisabled,
                addTierTooltip,
                internalStorageUsage
            });
        }
    }

    onAddTer() {

    }
}

export default {
    viewModel: BucketDataPlacementFormViewModel,
    template: template
};
