/* Copyright (C) 2016 NooBaa */

import template from './assign-region-modal.html';
import ConnectableViewModel from 'components/connectable';
import { equalIgnoreCase } from 'utils/string-utils';
import { unassignedRegionText } from 'utils/resource-utils';
import { closeModal, assignRegionToResource } from 'action-creators';
import ko from 'knockout';

class AssignRegionModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    resourceType = '';
    resourceName = '';
    fields = ko.observable();

    selectState(state, params) {
        const { resourceType, resourceName } = params;
        const { hostPools = {}, cloudResources = {} } = state;
        const resource =
            (resourceType === 'HOSTS' && hostPools[resourceName]) ||
            (resourceType === 'CLOUD' && cloudResources[resourceName]) ||
            null;

        return [
            resourceType,
            resourceName,
            resource ? resource.region : ''
        ];
    }

    mapStateToProps(resourceType, resourceName, region) {
        this.resourceType = resourceType;
        this.resourceName = resourceName;

        if (!this.fields()) {
            this.fields({ region });
        }
    }

    onValidate(values) {
        const { region } = values;
        const errors = {};

        if (region) {
            if (region.length < 3 || region.length > 32) {
                errors.region = 'Region tag must be between 3-32 characters';
            }

            if (equalIgnoreCase(region.trim(), unassignedRegionText)) {
                errors.region = `"${unassignedRegionText}" is reserved and cannot be used as a region name`;
            }
        }

        return errors;
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    onSubmit(values) {
        const { resourceType, resourceName } = this;

        this.dispatch(
            assignRegionToResource(resourceType, resourceName, values.region),
            closeModal()
        );
    }
}

export default {
    viewModel: AssignRegionModalViewModel,
    template: template
};
