/* Copyright (C) 2016 NooBaa */

import template from './app.html';
import ko from 'knockout';
import ConnectableViewModel from 'components/connectable';
import { requestLocation, openManagementConsoleErrorModal } from 'action-creators';
import * as routes from 'routes';
import { realizeUri } from 'utils/browser-utils';
import { themes, defaultTheme } from 'config';

class AppViewModel extends ConnectableViewModel {
    layout = ko.observable('empty');
    css = ko.observable();

    selectState(state) {
        return [
            state.session,
            state.location,
            state.env.previewContent,
            state.lastError
        ];
    }

    mapStateToProps(session, location = {}, previewContent, lastError) {
        if (lastError) {
            this.dispatch(openManagementConsoleErrorModal());
            return;
        }

        if (session && !location.route) {
            // Redirect to the system routes
            const url = realizeUri(routes.system, { system: session.system });
            this.dispatch(requestLocation(url, true));
            return;
        }

        const layout = (session && !session.passwordExpired) ?
            'main-layout' :
            'login-layout';

        const previewCss = previewContent ? 'preview' : '';
        const themeCss = themes[(session ? session.uiTheme : defaultTheme)];
        const css = [previewCss, themeCss]
            .filter(Boolean)
            .join(' ');

        this.layout(layout);
        this.css(css);
    }
}

export default {
    viewModel: AppViewModel,
    template: template
};
