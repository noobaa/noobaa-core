/* Copyright (C) 2016 NooBaa */

import template from './proxy-server-form.html';
import ConnectableViewModel from 'components/connectable';
import { realizeUri } from 'utils/browser-utils';
import { isIPOrDNSName, isPortNumber } from 'utils/net-utils';
import { getFieldError, isFormDirty } from 'utils/form-utils';
import ko from 'knockout';
import { api } from 'services';
import {
    requestLocation,
    updateProxyServerSettings
} from 'action-creators';

const sectionName = 'proxy-server';

class ProxyServerFormViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    dataReady = ko.observable();
    isExpanded = ko.observable();
    toggleUri = '';
    address = {
        text: ko.observable(),
        css: ko.observable()
    };
    formFields = ko.observable();
    globalError = ko.observable();
    isDirtyMarkerVisible = ko.observable();

    selectState(state) {
        const { system, location, forms } = state;
        return [
            Boolean(system),
            system && system.proxyServer,
            location,
            forms[this.formName]
        ];
    }

    mapStateToProps(systemLoaded, proxy, location, form) {
        if (!systemLoaded) {
            ko.assignToProps(this,{
                dataReady: false
            });

        } else {
            const { system, tab = 'settings', section } = location.params;
            const toggleSection = section === sectionName ? undefined : sectionName;
            const globalError = form && getFieldError(form, 'global');

            ko.assignToProps(this, {
                dataReady: true,
                isExpanded: section === sectionName,
                toggleUri: realizeUri(location.route, { system, tab, section: toggleSection }),
                address: {
                    text: proxy ? `${proxy.endpoint}:${proxy.port}` : 'Not set',
                    css: proxy ? 'text-tech' : ''
                },
                globalError:  globalError || '',
                isDirtyMarkerVisible: form ? isFormDirty(form) : false,
                formFields: !form ? {
                    isConfigured: Boolean(proxy),
                    endpoint: proxy ? proxy.endpoint : '',
                    port: proxy ? proxy.port : ''
                } : undefined
            });
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onValidate(values) {
        const { isConfigured, endpoint, port } = values;
        const errors = {};

        if (isConfigured) {
            if (!isIPOrDNSName(endpoint)) {
                errors.endpoint = 'Please enter an IP or DNS name';
            }

            if (!isPortNumber(port)) {
                errors.port = 'Please enter a port number between 1 and 65535';
            }
        }

        return errors;
    }

    async onValidateSubmit(values) {
        const { isConfigured, endpoint, port } = values;
        const errors = {};

        if (isConfigured) {
            const proxy_address = `http://${endpoint}:${port}`;
            const reachable = await api.system.verify_phonehome_connectivity({ proxy_address });
            if (!reachable) {
                errors.endpoint = errors.port = '';
                errors.global = 'External services could not be reached using the above configuration';
            }
        }

        return errors;
    }

    onSubmit(values) {
        const { isConfigured, endpoint, port } = values;
        const address = isConfigured ? { endpoint, port } : null;

        this.dispatch(updateProxyServerSettings(address));
    }
}

export default {
    viewModel: ProxyServerFormViewModel,
    template: template
};
