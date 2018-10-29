/* Copyright (C) 2016 NooBaa */

import template from './edit-tier-data-placement-modal.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { getResourceId } from 'utils/resource-utils';
import { warnPlacementPolicy, validatePlacementPolicy } from 'utils/bucket-utils';
import { closeModal, updateTierPlacementPolicy } from 'action-creators';
import ko from 'knockout';

function _mapResourcesToRegions(resType, resCollection) {
    return Object.values(resCollection).map(res => ({
        id: getResourceId(resType, res.name),
        region: res.region
    }));
}

class EditTierDataPlacementModalViewModel extends ConnectableViewModel {
    bucketName = '';
    tierName = '';
    resourcesHref = '#';
    dataReady = ko.observable();
    hostPools = ko.observable();
    cloudResources = ko.observable();
    formName = this.constructor.name;
    formFields = ko.observable();

    onWarn = warnPlacementPolicy;
    onValidate = validatePlacementPolicy;

    selectState(state, params) {
        const { bucketName, tierName } = params;

        const bucket = state.buckets &&
            state.buckets[params.bucketName];

        const tier = bucket && bucket.placement2.tiers.find(
            tier => tier.name === tierName
        );

        return [
            bucketName,
            tier,
            state.hostPools,
            state.cloudResources,
        ];
    }

    mapStateToProps(bucketName, tier, hostPools, cloudResources) {
        if (!hostPools || !cloudResources) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            ko.assignToProps(this, {
                dataReady: true,
                bucketName,
                tierName: tier.name,
                hostPools,
                cloudResources,
                formFields: !this.formFields() ? {
                    policyType: tier.policyType,
                    selectedResources: flatMap(
                        tier.mirrorSets,
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

        this.dispatch(closeModal());
        this.dispatch(updateTierPlacementPolicy(bucketName, tierName, policyType, selectedResources));
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditTierDataPlacementModalViewModel,
    template: template
};
