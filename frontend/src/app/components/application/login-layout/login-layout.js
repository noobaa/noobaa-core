/* Copyright (C) 2016 NooBaa */

import template from './login-layout.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { supportedBrowsers} from 'config';
import { sessionInfo, serverInfo } from 'model';
import { recognizeBrowser } from 'utils/browser-utils';

class LoginLayoutViewModel extends BaseViewModel {
    constructor() {
        super();

        this.form = ko.pureComputed(
            () => {
                if (!supportedBrowsers.includes(recognizeBrowser())) {
                    return 'unsupported-form';
                }

                if (!serverInfo()) {
                    return 'internet-connectivity-problem-form';
                }

                const { initialized, config } = serverInfo();
                if (initialized) {
                    if (!sessionInfo()) {
                        return 'signin-form';

                    } else if(sessionInfo().mustChangePassword) {
                        return 'change-password-form';
                    }
                } else {
                    if (config.phone_home_connectivity_status !== 'CONNECTED') {
                        return 'internet-connectivity-problem-form';
                    }

                    return 'create-system-form';
                }
            }
        );
    }
}

export default {
    viewModel: LoginLayoutViewModel,
    template: template
};
