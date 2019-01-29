/* Copyright (C) 2016 NooBaa */

import template from './edit-server-dns-settings-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal, updateServerDNSSettings } from 'action-creators';
import { isDNSName, isIP } from 'utils/net-utils';
import { getFieldValue } from 'utils/form-utils';
import ko from 'knockout';

const searchDomainTooltip = 'If configured, search domains will be added to the fully qualified domain names when trying to resolve host names';

class EditServerDNSSettingsModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    serverSecret = '';
    serverHostname = '';
    hasNoPrimaryDNS = ko.observable();
    formFields = ko.observable();
    tokenValidator = isDNSName;
    searchDomainTooltip = searchDomainTooltip;

    selectState(state, params) {
        const { servers } = state.topology || {};
        return [
            servers && servers[params.serverSecret],
            state.forms[this.formName]
        ];
    }

    mapStateToProps(server, form) {
        if (server) {
            const { secret, hostname, dns  } = server;

            if (form) {
                ko.assignToProps(this, {
                    serverSecret: secret,
                    serverHostname: hostname,
                    hasNoPrimaryDNS: !getFieldValue(form, 'primaryDNS')
                });

            } else {
                const [
                    primaryDNS = '',
                    secondaryDNS = ''
                ] = dns.servers.list;

                ko.assignToProps(this, {
                    serverSecret: secret,
                    serverHostname: hostname,
                    hasNoPrimaryDNS: !primaryDNS,
                    formFields: {
                        primaryDNS,
                        secondaryDNS,
                        searchDomains: dns.searchDomains
                    }
                });
            }
        }
    }

    onValidate(values) {
        const { primaryDNS, secondaryDNS, searchDomains } = values;
        const errors = {};

        if (primaryDNS && !isIP(primaryDNS)) {
            errors.primaryDNS = 'Please enter a valid IP address';

        }

        if (secondaryDNS && !isIP(secondaryDNS)) {
            errors.secondaryDNS = 'Please enter a valid IP address';
        }

        if (!searchDomains.every(isDNSName)) {
            errors.searchDomains = 'All values must be a valid domain names';
        }

        return errors;
    }

    onSubmit(values) {
        const { serverSecret, serverHostname } = this;
        const { primaryDNS, secondaryDNS, searchDomains } = values;

        this.dispatch(
            updateServerDNSSettings(
                serverSecret,
                serverHostname,
                primaryDNS,
                secondaryDNS,
                searchDomains
            ),
            closeModal()
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditServerDNSSettingsModalViewModel,
    template: template
};
