import template from './login-layout.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { supportedBrowsers} from 'config';
import { serverInfo } from 'model';
import { recognizeBrowser } from 'utils';

class LoginLayoutViewModel extends Disposable {
    constructor() {
        super();

        this.form = ko.pureComputed(
            () => {
                if (!supportedBrowsers.includes(recognizeBrowser())) {
                    return 'unsupported-form';
                }

                if (!serverInfo()) {
                    return 'loading-server-information-from';
                }

                let { initialized, config } = serverInfo();
                if (initialized) {
                    return 'signin-form';
                }

                if (config.phone_home_connectivity_status !== 'CONNECTED') {
                    return 'loading-server-information-from';
                } else {
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
