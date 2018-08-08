/* Copyright (C) 2016 NooBaa */

import template from './assign-region-modal.html';
import ConnectableViewModel from 'components/connectable';
import { memoize, keyByProperty } from 'utils/core-utils';
import { equalIgnoreCase, stringifyAmount } from 'utils/string-utils';
import { unassignedRegionText } from 'utils/resource-utils';
import { closeModal, assignRegionToResource } from 'action-creators';
import ko from 'knockout';

class AssignRegionModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    resourceType = '';
    resourceName = '';
    fields = ko.observable();
    regionSuggestions = ko.observableArray();

    selectRegionList = memoize((hostPools, cloudResources, resourceName) => {
        const resources = [
            ...Object.values(hostPools),
            ...Object.values(cloudResources)
        ];

        const usageMap = keyByProperty(
            resources.filter(res =>
                res.name !== resourceName && Boolean(res.region)
            ),
            'region',
            (_0, _1, usage) => usage ? usage + 1 : 1
        );

        return Object.entries(usageMap)
            .map(([name, usage]) => ({ name, usage }));
    });

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
            resource ? resource.region : '',
            this.selectRegionList(hostPools, cloudResources, resourceName)
        ];
    }

    mapStateToProps(resourceType, resourceName, region, regionList) {
        ko.assignToProps(this, {
            resourceType: resourceType,
            resourceName: resourceName,
            regionSuggestions: regionList.map(region => ({
                value: region.name,
                remark: `Used by ${stringifyAmount('resource', region.usage)}`
            })),
            fields: !this.fields() ?
                { region } :
                undefined
        });
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
