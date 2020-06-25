/* Copyright (C) 2016 NooBaa */

import template from './login-layout.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { supportedBrowsers, logo } from 'config';
import { sessionInfo, serverInfo, loginInfo } from 'model';
import { recognizeBrowser } from 'utils/browser-utils';
import { loadServerInfo } from 'actions';
import { isUndefined } from 'utils/core-utils';
import { requestLocation, openOAuthUnauthorizedModal } from 'action-creators';
import { action$ } from 'state';
import * as routes from 'routes';

class LoginLayoutViewModel extends BaseViewModel {
    constructor() {
        super();

        this.logo = logo;
        this.form = ko.pureComputed(
            () => {
                console.warn('OMOMOM HERE', loginInfo());
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

                    } else if (location.pathname === routes.oauthCallback) {
                        return 'oauth-callback';

                    } else if (!session) {
                        // Specific params to force login screen (to allow login using local users)
                        const skipOAuth = new URLSearchParams(location.search).get('skip-oauth');
                        if (serverInfo().supportOAuth && skipOAuth == null) {
                            if (loginInfo().unauthorized) {
                                action$.next(openOAuthUnauthorizedModal());
                                return 'splash-screen';

                            } else {
                                this.signInWithOAuth();
                                return 'splash-screen';
                            }
                        }

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

    signInWithOAuth() {
        const { pathname } = window.location;
        const url = `/oauth/authorize?return-url=${encodeURIComponent(pathname)}`;
        action$.next(requestLocation(url));
    }
}

export default {
    viewModel: LoginLayoutViewModel,
    template: template
};
