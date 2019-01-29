/* Copyright (C) 2016 NooBaa */

import template from './internet-connectivity-problem-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { serverInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { loadServerInfo } from 'actions';
import { action$ } from 'state';
import { openUnableToActivateModal } from 'action-creators';

const hasConnectivityOptions = deepFreeze([
    { label: 'Yes', value: false },
    { label: 'No, I need to set a proxy address', value: true }
]);

const addressValMessage = 'Please enter a valid IP or DNS name';
const portValMessage = 'Please enter a port number between 1 and 65535';

const failureReasons = deepFreeze({
    WAS_NOT_TESTED: '',
    CANNOT_REACH_DNS_SERVER: 'We found that your DNS server is unreachable, please verify that the DNS server address is correct or use the first installation wizard to update.',
    CANNOT_RESOLVE_PHONEHOME_NAME: 'We couldn\'t resolve <i>phonehome.noobaa.com</i>, please verify that your DNS server can resolve public names.',
    CANNOT_CONNECT_INTERNET: 'We couldn\'t connect to the internet, please verify that your internet connection settings are correct and then retry.',
    CANNOT_CONNECT_PHONEHOME_SERVER: 'We couldn\'t connect to <i>phonehome.noobaa.com</i>, please verify that your internet connection settings are correct and then retry.',
    MALFORMED_RESPONSE: 'We got a malformed response, this may be the result of using a proxy. Try to configure direct access for the create system process or use a different proxy (after activation you can reactivate the original proxy).'
});

class LoadingServerInformationFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.hasConnectivityOptions = hasConnectivityOptions;

        this.serverInfoLoaded = ko.pureComputed(
            () => Boolean(serverInfo())
        );

        this.useProxy = ko.observable(false);
        this.proxyAddress = ko.observable()
            .extend({
                required: {
                    onlyIf: this.useProxy,
                    message: addressValMessage
                },
                isIPOrDNSName: {
                    onlyIf: this.useProxy,
                    message: addressValMessage
                }
            });
        this.proxyPort = ko.observable(80)
            .extend({
                required: {
                    onlyIf: this.useProxy,
                    message: portValMessage
                },
                inRange: {
                    onlyIf: this.useProxy,
                    params: { min: 1, max: 65535 },
                    message: portValMessage
                }
            });

        this.faliureReason = failureReasons.CANNOT_RESOLVE_PHONEHOME_NAME;
        // this.faliureReason = ko.pureComputed(
        //     () => serverInfo() &&
        //         serverInfo().config &&
        //         failureReasons[
        //             serverInfo().config.phone_home_connectivity_status
        //         ]
        // );

        this.errors = ko.validation.group(this);
    }

    onCheckConnection() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            const { useProxy, proxyAddress, proxyPort } = this;
            const proxy = useProxy() ?
                { address: proxyAddress(), port: Number(proxyPort()) } :
                undefined;

            loadServerInfo(true, proxy);
        }
    }

    onMoreDetails() {
        action$.next(openUnableToActivateModal(this.faliureReason()));
    }
}

export default {
    viewModel: LoadingServerInformationFormViewModel,
    template: template
};
