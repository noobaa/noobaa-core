/* Copyright (C) 2018 NooBaa */

import template from './system-address-form.html';
import Observer from 'observer';
import ko from 'knockout';
import { isDNSName } from 'utils/net-utils';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getFieldValue, isFormDirty, isFieldTouchedAndInvalid } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import * as routes from 'routes';
import { action$, state$ } from 'state';
import { api } from 'services';
import {
    openUpdateSystemNameModal,
    requestLocation
} from 'action-creators';

const sectionName = 'system-address';
const addressOptions = deepFreeze([
    { label: 'Use Server IP', value: 'IP' },
    { label: 'Use DNS Name (recommended)', value: 'DNS' }
]);

class SystemAddressFormViewModel extends Observer {
    formName = this.constructor.name;
    addressOptions = addressOptions;
    isExpanded = ko.observable();
    isDnsNameRemarkVisible = ko.observable();
    isDirtyMarkerVisible = ko.observable();
    systemAddress = ko.observable();
    ipAddress = ko.observable();
    fields = ko.observable();
    asyncValidationTriggers = [
        'addressType',
        'dnsName'
    ];

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    ['system', 'dnsName'],
                    ['system', 'ipAddress'],
                    'location',
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([dnsName, ipAddress, location, form]) {
        if (!ipAddress) {
            this.isDirtyMarkerVisible(false);
            return;
        }

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
        //TODO: remove  ``` = 'settings' ``` default tab should be used in uri if tab undefined
        const { system, tab = 'settings', section } = location.params;
        const toggleSection = section === sectionName ? undefined : sectionName;
        const toggleUri = realizeUri(
            routes.management,
            { system, tab, section: toggleSection }
        );

        this.isDnsNameRemarkVisible(isDnsNameRemarkVisible);
        this.ipAddress(ipAddress);
        this.systemAddress(systemAddress);
        this.isDirtyMarkerVisible(isDirtyMarkerVisible);
        this.isExpanded(section === sectionName);
        this.toggleUri = toggleUri;

        if (!this.fields()) {
            this.fields({ addressType, dnsName });
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
        action$.next(openUpdateSystemNameModal(address));
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }
}

export default {
    viewModel: SystemAddressFormViewModel,
    template: template
};
