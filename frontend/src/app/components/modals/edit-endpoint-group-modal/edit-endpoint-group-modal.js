/* Copyright (C) 2016 NooBaa */

import template from './edit-endpoint-group-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { getFormValues } from 'utils/form-utils';
import {
    updateEndpointGroup,
    closeModal
} from 'action-creators';

class EditEndpointGroupModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    groupName = '';
    toggleRemark = ko.observable();
    endpointCountLabel = ko.observable();
    formFields = ko.observable()

    selectState(state, params) {
        const { endpointGroups = {}, forms = {} } = state;
        return [
            endpointGroups[params.groupName],
            forms[this.formName]
        ];
    }

    mapStateToProps(group, form) {
        if (!group) {
            return;
        }

        const { endpointRange } = group;
        const {
            useAutoScaling = endpointRange.min === endpointRange.max,
            minCount = endpointRange.min,
            maxCount = endpointRange.max
        } = form ? getFormValues(form) : {};


        ko.assignToProps(this, {
            groupName: group.name,
            toggleRemark: useAutoScaling ?
                'The number of endpoints will automatically increase/decrease based on Kubernetes metrics' :
                'The number of endpoints will remain constant regardless of Kubernetes metrics',

            endpointCountLabel: useAutoScaling ?
                'Endpoint Range' :
                'Number of Endpoints ',

            formFields: !form ? {
                useAutoScaling,
                minCount,
                maxCount
            } : undefined
        });
    }

    onValidate(values) {
        const errors = {};
        const { useAutoScaling, minCount, maxCount } = values;

        if (minCount < 1) {
            errors.minCount = useAutoScaling ?
                'Invalid range, Lower bound must be greater then 1' :
                'Nubmer of endpoint must be greater then 1';

        } else if (useAutoScaling && maxCount < minCount)  {
            errors.minCount = 'Invalid range, upper bound must be greater than lower bound';
        }

        return errors;
    }

    onSubmit(values) {
        const { useAutoScaling, minCount, maxCount } = values;
        const endpointConf = {
            minCount: minCount,
            maxCount: useAutoScaling ? maxCount : minCount
        };

        this.dispatch(
            closeModal(),
            updateEndpointGroup(this.groupName, endpointConf)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditEndpointGroupModalViewModel,
    template: template
};
