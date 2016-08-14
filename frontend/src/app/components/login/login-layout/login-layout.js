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

                if (serverInfo()) {
                    return serverInfo().initialized ? 'signin-form' : 'create-system-form';
                }

                return;
            }
        );
    }
}

export default {
    viewModel: LoginLayoutViewModel,
    template: template
};
