/* Copyright (C) 2016 NooBaa */

import template from './empty-data-placement-warning-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal } from 'action-creators';
import ko from 'knockout';

function _getMessage(tiers, tierName) {
    const hasNoOtherResources = tiers
        .filter(tier => tier.name !== tierName)
        .every(tier => tier.mode === 'NO_RESOURCES');

    if (hasNoOtherResources) {
        return 'Removing all resources from the tier data placement policy will cause data inaccessibility.';

    } else {
        const i = tiers.findIndex(tier => tier.name == tierName);
        return `Removing all the tier’s resources will leave tier ${i + 1} inoperable until new resources will be added.`;
    }
}

class EmptyDataPlacementWarningModalViewModel extends ConnectableViewModel {
    action = null;
    message = ko.observable();

    selectState(state, params) {
        const bucket = state.buckets &&
            state.buckets[params.bucketName];

        return [
            bucket && bucket.placement2.tiers,
            params.tierName,
            params.action
        ];
    }

    mapStateToProps(tiers, tierName, action) {
        if (!tiers) {
            return;
        }

        const message = _getMessage(tiers, tierName);
        ko.assignToProps(this, { action, message });
    }

    onBack() {
        this.dispatch(closeModal());
    }

    onContinue() {
        this.dispatch(
            closeModal(Infinity),
            this.action
        );
    }
}

export default {
    viewModel: EmptyDataPlacementWarningModalViewModel,
    template: template
};
