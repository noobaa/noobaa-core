/* Copyright (C) 2016 NooBaa */

import template from './login-layout.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { supportedBrowsers, logo } from 'config';
import { sessionInfo, serverInfo } from 'model';
import { recognizeBrowser } from 'utils/browser-utils';
import { loadServerInfo } from 'actions';
import { isUndefined } from 'utils/core-utils';

class LoginLayoutViewModel extends BaseViewModel {
    constructor() {
        super();

        this.logo = logo;
        this.form = ko.pureComputed(
            () => {
                if (!supportedBrowsers.includes(recognizeBrowser())) {
                    return 'unsupported-form';
                }

                if (!serverInfo()) {
                    return 'splash-screen';
                }

                const { initialized } = serverInfo();
                if (initialized) {
                    const session = sessionInfo();
                    if (isUndefined(session)) {
                        return 'splash-screen';

                    } else if (!session) {
                        return 'signin-form';

                    } else if (session.passwordExpired) {
                        return 'change-password-form';

                    } else {
                        return 'empty';
                    }

                } else {
                    return 'create-system-form';
                }
            }
        );

        if (!serverInfo()) {
            loadServerInfo();
        }
    }
}

export default {
    viewModel: LoginLayoutViewModel,
    template: template
};
