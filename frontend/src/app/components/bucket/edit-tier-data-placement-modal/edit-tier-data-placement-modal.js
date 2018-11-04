/* Copyright (C) 2016 NooBaa */

import template from './edit-tier-data-placement-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { flatMap } from 'utils/core-utils';
import { getResourceId } from 'utils/resource-utils';
import {
    warnPlacementPolicy,
    validatePlacementPolicy,
    flatPlacementPolicy
} from 'utils/bucket-utils';
import {
    closeModal,
    updateTierPlacementPolicy,
    openEmptyDataPlacementWarningModal
} from 'action-creators';

class EditTierDataPlacementModalViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    bucketName = '';
    tierName = '';
    resourcesHref = '#'; // TODO fill in href
    hostPools = ko.observable();
    cloudResources = ko.observable();
    resourcesInUse = ko.observableArray();
    formName = this.constructor.name;
    formFields = ko.observable();

    onWarn = warnPlacementPolicy;
    onValidate = validatePlacementPolicy;

    selectState(state, params) {
        const { buckets, hostPools, cloudResources } = state;
        const { bucketName, tierName } = params;
        const bucket = buckets && buckets[bucketName];

        return [
            tierName,
            bucket,
            hostPools,
            cloudResources
        ];
    }

    mapStateToProps(tierName, bucket, hostPools, cloudResources) {
        if (!bucket || !hostPools || !cloudResources) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const tier = bucket.placement2.tiers.find(tier =>
                tier.name === tierName
            );

            const resourcesInUse = flatPlacementPolicy(bucket)
                .filter(record => record.tier !== tierName)
                .map(record => {
                    const { type, name } = record.resource;
                    return getResourceId(type, name);
                });

            ko.assignToProps(this, {
                dataReady: true,
                bucketName: bucket.name,
                tierName: tier.name,
                hostPools,
                cloudResources,
                resourcesInUse,
                formFields: !this.formFields() ? {
                    policyType: tier.policyType === 'INTERNAL_STORGE' ?
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
        const { bucketName, tierName } = this;
        const { policyType, selectedResources } = values;
        const action = updateTierPlacementPolicy(bucketName, tierName, policyType, selectedResources);

        if (selectedResources.length > 0) {
            this.dispatch(closeModal());
            this.dispatch(action);

        } else {
            this.dispatch(openEmptyDataPlacementWarningModal({ action }));
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
