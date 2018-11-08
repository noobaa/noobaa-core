/* Copyright (C) 2016 NooBaa */

import template from './bucket-placement-summary-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { closeModal } from 'action-creators';
import { flatMap, countBy } from 'utils/core-utils';
import { aggregateStorage } from 'utils/storage-utils';
import { sumSize } from 'utils/size-utils';
import { getPlacementTypeDisplayName } from 'utils/bucket-utils';
import numeral from 'numeral';

class TierSummaryViewModal {
    label = ko.observable();
    policyType = ko.observable();
    hostPoolCount = ko.observable();
    cloudResourceCount = ko.observable();
    capacity = {
        total: ko.observable(),
        used: ko.observable()
    };
}

class BucketPlacementSummaryModalViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    tiers = ko.observableArray()
        .ofType(TierSummaryViewModal);

    selectState(state, params) {
        const { bucketName } = params;
        const { buckets, hostPools, cloudResources } = state;
        const tiers =
            buckets &&
            buckets[bucketName] &&
            buckets[bucketName].placement.tiers;


        return [
            tiers,
            hostPools,
            cloudResources
        ];
    }

    mapStateToProps(tiers, hostPools, cloudResources) {
        if (!tiers) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const tiersSummary = tiers.map((tier, i) => {
                const { policyType, mirrorSets } = tier;
                const resources = flatMap(mirrorSets, ms => ms.resources);

                const {
                    HOSTS: hostPoolCount = 0,
                    CLOUD: cloudResourceCount = 0
                } = countBy(resources, res => res.type);

                const storage = aggregateStorage(
                    ...resources.map(res => {
                        const coll = res.type === 'HOSTS' ? hostPools: cloudResources;
                        return coll[res.name].storage;
                    })
                );

                return {
                    label: `Tier ${i + 1}`,
                    policyType: getPlacementTypeDisplayName(policyType),
                    hostPoolCount: numeral(hostPoolCount).format(','),
                    cloudResourceCount: numeral(cloudResourceCount).format(','),
                    capacity: {
                        total: storage.total || 0,
                        used: sumSize(
                            storage.used || 0,
                            storage.usedOther || 0,
                            storage.unavailableUsed || 0
                        )
                    }
                };
            });

            ko.assignToProps(this, {
                dataReady: true,
                tiers: tiersSummary
            });
        }
    }

    onDone() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: BucketPlacementSummaryModalViewModel,
    template: template
};
