/* Copyright (C) 2016 NooBaa */

import template from './add-tier-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { flatMap, countBy } from 'utils/core-utils';
import { getResourceId } from 'utils/resource-utils';
import { realizeUri } from 'utils/browser-utils';
import {
    warnPlacementPolicy,
    validatePlacementPolicy,
    flatPlacementPolicy
} from 'utils/bucket-utils';
import { addBucketTier, closeModal } from 'action-creators';
import * as routes from 'routes';

function _getTierSummary(tier, tierIndex, hostPools, cloudResources) {
    const resources = flatMap(
        tier.mirrorSets,
        ms => ms.resources
    );

    const {
        HOSTS: hostPoolCount = 0,
        CLOUD: cloudResourceCount = 0
    } = countBy(resources, res => res.type);

    const resSummary = `${
        stringifyAmount('Host Pool', hostPoolCount)
    }<br/>${
        stringifyAmount('Cloud resource', cloudResourceCount)
    }`;

    const capacity = formatSize(sumSize(
        ...resources.map(res => {
            const { type, name } = res;
            const coll = type === 'HOSTS' ? hostPools : cloudResources;
            return coll[name].storage.total;
        })
    ));

    return {
        text: `Tier ${tierIndex + 1}`,
        tooltip: {
            template: 'propertySheet',
            text: [
                { label: 'Resources', value: resSummary },
                { label: 'Capacity', value: capacity }
            ],
            align: 'start'
        }
    };
}

class AddTierModalViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    resourcesHref = '';
    bucketName = '';
    tiersSummary = ko.observable();
    tableTitle = ko.observable();
    hostPools = ko.observable();
    cloudResources = ko.observable();
    resourcesInUse = ko.observableArray();
    formName = this.constructor.name;
    formFields = {
        policyType: 'SPREAD',
        selectedResources: []
    };

    onWarn = warnPlacementPolicy;
    onValidate = validatePlacementPolicy;

    selectState(state, params) {
        const { buckets, hostPools, cloudResources, location } = state;
        const bucket = buckets && buckets[params.bucketName];
        return [
            bucket,
            hostPools,
            cloudResources,
            location.params.system
        ];
    }

    mapStateToProps(bucket, hostPools, cloudResources, system) {
        if (!bucket || !hostPools || !cloudResources) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { tiers } = bucket.placement2;
            const tableTitle = `Resources in Tier ${tiers.length + 1} policy`;
            const tiersSummary = [
                ...tiers.map((tier, i) =>
                    _getTierSummary(tier, i, hostPools, cloudResources)
                ),
                {
                    text: `Tier ${tiers.length + 1}`,
                    css: 'dim'
                }
            ];
            const resourcesInUse = flatPlacementPolicy(bucket)
                .map(record => {
                    const { type, name } = record.resource;
                    return getResourceId(type, name);
                });
            const resourcesHref = realizeUri(routes.resources, { system });

            ko.assignToProps(this, {
                dataReady: true,
                bucketName: bucket.name,
                tiersSummary,
                tableTitle,
                hostPools,
                cloudResources,
                resourcesInUse,
                resourcesHref
            });
        }
    }

    onSubmit(values) {
        this.dispatch(closeModal());
        this.dispatch(addBucketTier(
            this.bucketName, values.policyType,
            values.selectedResources
        ));
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: AddTierModalViewModel,
    template: template
};
