/* Copyright (C) 2018 NooBaa */

import template from './system-address-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { isDNSName } from 'utils/net-utils';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getFieldValue, isFormDirty, isFieldTouchedAndInvalid } from 'utils/form-utils';
import * as routes from 'routes';
import { api } from 'services';
import {
    openUpdateSystemNameModal,
    requestLocation
} from 'action-creators';

const sectionName = 'system-address';
const notAllowedTooltip = 'DNS configuration is not supported in a container environment. Please configure via the host.';
const addressOptions = deepFreeze([
    { label: 'Use Server IP', value: 'IP' },
    { label: 'Use DNS Name (recommended)', value: 'DNS' }
]);

class SystemAddressFormViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    addressOptions = addressOptions;
    isExpanded = ko.observable();
    toggleUri = '';
    isDnsNameRemarkVisible = ko.observable();
    isDirtyMarkerVisible = ko.observable();
    systemAddress = ko.observable();
    ipAddress = ko.observable();
    isUpdateDisabled = ko.observable();
    updateButtonTooltip = {
        align: 'start',
        text: ko.observable()
    };
    fields = ko.observable();
    asyncValidationTriggers = [
        'addressType',
        'dnsName'
    ];

    selectState(state) {
        const { system, location, forms, platform } = state;

        return [
            system,
            location,
            forms[this.formName],
            platform && platform.featureFlags.systemAddressChange
        ];
    }

    mapStateToProps(system, location, form, allowAddressChange) {
        if (!system) {
            ko.assignToProps(this, {
                isDirtyMarkerVisible: false,
                systemAddress: ''
            });

        } else {
            const { ipAddress, dnsName } = system;
            const addressType =
                (form && getFieldValue(form, 'addressType')) ||
                (dnsName && 'DNS') ||
                'IP';

            const systemAddress =
                (addressType === 'IP' && ipAddress) ||
                (form && getFieldValue(form, 'dnsName')) ||
                dnsName;

            const isDnsNameRemarkVisible = !form || !isFieldTouchedAndInvalid(form, 'dnsName');
            const isDirtyMarkerVisible = form ? isFormDirty(form) : false;
            const { system: systemName, tab = 'settings', section } = location.params;
            const toggleSection = section === sectionName ? undefined : sectionName;
            const toggleUri = realizeUri(
                routes.management,
                { system: systemName, tab, section: toggleSection }
            );

            ko.assignToProps(this, {
                isDnsNameRemarkVisible,
                ipAddress,
                systemAddress,
                isDirtyMarkerVisible,
                isExpanded: section === sectionName,
                toggleUri,
                isUpdateDisabled: !allowAddressChange,
                updateButtonTooltip: {
                    text: allowAddressChange ? '' : notAllowedTooltip
                },
                fields: !form ? { addressType, dnsName } : undefined
            });
        }
    }

    onValidate(values) {
        const { addressType, dnsName } = values;
        const errors = {};
        if (addressType === 'DNS' && (!dnsName || !isDNSName(dnsName))) {
            errors.dnsName = 'Please enter a valid DNS Name';
        }

        return errors;
    }

    async onValidateAsync(values) {
        const { addressType, dnsName } = values;
        const errors = {};

        if (addressType === 'DNS') {
            const { valid } = await api.system.attempt_server_resolve({
                server_name: dnsName,
                version_check: true
            });

            if (!valid) {
                errors.dnsName = 'Could not resolve dns name';
            }
        }

        return errors;
    }

    onSubmit(values) {
        const { addressType, dnsName } = values;
        const address = addressType === 'IP' ? this.ipAddress() : dnsName;
        this.dispatch(openUpdateSystemNameModal(address));
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }
}

export default {
    viewModel: SystemAddressFormViewModel,
    template: template
};
