/* Copyright (C) 2016 NooBaa */

import template from './deploy-remote-endpoint-group-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { getFieldValue } from 'utils/form-utils';
import {
    generateEndpointGroupDeploymentYAML,
    closeModal
} from 'action-creators';


class DeployRemoteEndpointGroupModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    toggleRemark = ko.observable();
    endpointCountLabel = ko.observable();
    formFields = {
        region: '',
        useAutoScaling: true,
        minCount: 1,
        maxCount: 10
    };

    selectState(state) {
        return [
            state.forms[this.formName]
        ];
    }

    mapStateToProps(form) {
        if (!form) {
            return;
        }

        const useAutoScaling = getFieldValue(form, 'useAutoScaling');
        ko.assignToProps(this, {
            toggleRemark: useAutoScaling ?
                'The number of endpoints will automatically increase/decrease based on Kubernetes metrics' :
                'The number of endpoints will remain constant regardless of Kubernetes metrics',

            endpointCountLabel: useAutoScaling ?
                'Endpoint Range' :
                'Number of Endpoints '
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
        const { region, useAutoScaling, minCount, maxCount } = values;
        const endpointConf = {
            minCount: minCount,
            maxCount: useAutoScaling ? maxCount : minCount
        };

        this.dispatch(
            generateEndpointGroupDeploymentYAML(region, endpointConf),
            closeModal()
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: DeployRemoteEndpointGroupModalViewModel,
    template: template
};
