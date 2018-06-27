/* Copyright (C) 2016 NooBaa */

import template from './proxy-server-form.html';
import Observer from 'observer';
import ko from 'knockout';

import { realizeUri } from 'utils/browser-utils';
import { isIPOrDNSName } from 'utils/net-utils';
import { clamp } from 'utils/core-utils';
import { isFormDirty, getFieldValue } from 'utils/form-utils';
import { action$, state$ } from 'state';
import { getMany } from 'rx-extensions';
import * as routes from 'routes';
import {
    COMPLETE_UPDATE_PROXY_ADDRESS,
    FAIL_UPDATE_PROXY_ADDRESS
} from 'action-types';
import {
    requestLocation,
    setProxyAddress,
    unsetProxyAddress,
    updateForm
} from 'action-creators';

const sectionName = 'proxy';

class ProxyServerViewModel extends Observer {
    dropActions = [COMPLETE_UPDATE_PROXY_ADDRESS, FAIL_UPDATE_PROXY_ADDRESS];
    formName = this.constructor.name;
    isExpanded = ko.observable();
    isDirtyMarkerVisible = ko.observable();
    proxyAddressText = ko.observable();
    fields = ko.observable();

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'system',
                    'location',
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([systemState, location, form]) {
        if (!systemState) {
            this.isDirtyMarkerVisible(false);
            return;
        }

        const { proxy } = systemState;
        const enabled = form ? getFieldValue(form, 'enabled') : Boolean(proxy);
        const address = (form && getFieldValue(form, 'address')) ||
            (proxy && proxy.address) ||
            '';

        const port = (form && getFieldValue(form, 'port')) ||
            (proxy && proxy.port) ||
            '';

        const proxyAddressText = (enabled && address && port) ? `http://${address}:${port}` : '';
        const isDirtyMarkerVisible = form ? isFormDirty(form) : false;
        const { system, tab = 'settings', section } = location.params;
        const toggleSection = section === sectionName ? undefined : sectionName;
        const toggleUri = realizeUri(
            routes.management,
            { system, tab, section: toggleSection }
        );

        this.proxyAddressText(proxyAddressText);
        this.isDirtyMarkerVisible(isDirtyMarkerVisible);
        this.isExpanded(section === sectionName);
        this.toggleUri = toggleUri;

        if (!this.fields()) {
            this.fields({
                enabled,
                address,
                port,
                isTestRunning: false
            });
        }
    }

    onValidate(values) {
        const { address, port, enabled } = values;
        const errors = {};

        if (enabled) {
            if (!isIPOrDNSName(address)) {
                errors.address = 'Please enter an IP or DNS name';
            }

            if (clamp(port, 1, 65535) !== port)  {
                errors.port = 'Please enter a port number between 1 and 65535';
            }
        }

        return errors;
    }

    onSubmit(values) {
        const { enabled, address, port } = values;

        action$.next(updateForm(this.formName, { isTestRunning: true }));

        if (enabled) {
            action$.next(setProxyAddress(address, port));
        } else {
            action$.next(unsetProxyAddress());
        }
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: ProxyServerViewModel,
    template: template
};
