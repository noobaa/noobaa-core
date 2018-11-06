/* Copyright (C) 2016 NooBaa */

import template from './edit-tier-data-placement-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { flatMap } from 'utils/core-utils';
import { getResourceId } from 'utils/resource-utils';
import { realizeUri } from 'utils/browser-utils';
import {
    warnPlacementPolicy,
    validatePlacementPolicy,
    flatPlacementPolicy
} from 'utils/bucket-utils';
import {
    closeModal,
    updateTierPlacementPolicy,
    openKeepUsingInternalStorageModal,
    openEmptyDataPlacementWarningModal
} from 'action-creators';
import * as routes from 'routes';

class EditTierDataPlacementModalViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    bucketName = '';
    tierName = '';
    usingInternalStorage = false;
    resourcesHref = '';
    hostPools = ko.observable();
    cloudResources = ko.observable();
    resourcesInUse = ko.observableArray();
    formName = this.constructor.name;
    formFields = ko.observable();

    onWarn = warnPlacementPolicy;
    onValidate = validatePlacementPolicy;

    selectState(state, params) {
        const { buckets, hostPools, cloudResources, location } = state;
        const { bucketName, tierName } = params;
        const bucket = buckets && buckets[bucketName];

        return [
            tierName,
            bucket,
            hostPools,
            cloudResources,
            location.params.system
        ];
    }

    mapStateToProps(tierName, bucket, hostPools, cloudResources, system) {
        if (!bucket || !hostPools || !cloudResources) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const tier = bucket.placement2.tiers.find(tier =>
                tier.name === tierName
            );
            const usingInternalStorage = tier.policyType === 'INTERNAL_STORAGE';
            const resourcesInUse = flatPlacementPolicy(bucket)
                .filter(record => record.tier !== tierName)
                .map(record => {
                    const { type, name } = record.resource;
                    return getResourceId(type, name);
                });
            const resourcesHref = realizeUri(routes.resources, { system });

            ko.assignToProps(this, {
                dataReady: true,
                bucketName: bucket.name,
                tierName: tier.name,
                usingInternalStorage,
                hostPools,
                cloudResources,
                resourcesInUse,
                resourcesHref,
                formFields: !this.formFields() ? {
                    policyType: !usingInternalStorage ?
                        tier.policyType :
                        'SPREAD',
                    selectedResources: flatMap(
                        tier.mirrorSets || [],
                        ms => ms.resources.map(res =>
                            getResourceId(res.type, res.name)
                        )
                    )
                } : undefined
            });
        }
    }

    onSubmit(values) {
        const { bucketName, tierName, usingInternalStorage } = this;
        const { policyType, selectedResources } = values;
        const action = updateTierPlacementPolicy(bucketName, tierName, policyType, selectedResources);

        if (selectedResources.length > 0) {
            this.dispatch(
                closeModal(),
                action
            );

        } else if (usingInternalStorage) {
            this.dispatch(openKeepUsingInternalStorageModal(action));

        } else {
            this.dispatch(openEmptyDataPlacementWarningModal(
                bucketName,
                tierName,
                action
            ));
        }


    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditTierDataPlacementModalViewModel,
    template: template
};
