/* Copyright (C) 2016 NooBaa */

import template from './add-tier-modal.html';
import tierSummaryTooltip from './tier-summary-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { aggregateStorage } from 'utils/storage-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { flatMap, countBy } from 'utils/core-utils';
import { getResourceId } from 'utils/resource-utils';
import { realizeUri } from 'utils/browser-utils';
import {
    warnPlacementPolicy,
    validatePlacementPolicy,
    flatPlacementPolicy,
    getPlacementTypeDisplayName
} from 'utils/bucket-utils';
import { addBucketTier, closeModal } from 'action-creators';
import * as routes from 'routes';

function _getTierSummary(tier, tierIndex, hostPools, cloudResources) {
    const resources = flatMap(
        tier.mirrorSets,
        ms => ms.resources
    );

    const policyTypeText = getPlacementTypeDisplayName(tier.policyType);

    const {
        HOSTS: hostPoolCount = 0,
        CLOUD: cloudResourceCount = 0
    } = countBy(resources, res => res.type);

    const hasResources = (hostPoolCount + cloudResourceCount) > 0;

    const hostPoolsText = hostPoolCount > 0 ?
        stringifyAmount('Node Pool', hostPoolCount) :
        '';

    const cloudResourcesText = cloudResourceCount > 0 ?
        stringifyAmount('Cloud resource', cloudResourceCount) :
        '';

    const storage = aggregateStorage(
        ...resources.map(res => {
            const coll = res.type === 'HOSTS' ? hostPools : cloudResources;
            return coll[res.name].storage;
        })
    );

    const { total = 0, free = 0, unavailableFree = 0 } = storage;
    const freeStorage = sumSize(free, unavailableFree);
    const availCapacityText = `${formatSize(freeStorage)} of ${formatSize(total)}`;

    return {
        text: `Tier ${tierIndex + 1}`,
        tooltip: {
            template: tierSummaryTooltip,
            text: {
                hasResources,
                policyTypeText,
                hostPoolsText,
                cloudResourcesText,
                availCapacityText
            },
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
            const { tiers } = bucket.placement;
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
