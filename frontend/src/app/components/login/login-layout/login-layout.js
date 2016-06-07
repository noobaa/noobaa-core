import template from './login-layout.html';
import ko from 'knockout';
import { isDefined } from 'utils';
import { serverInfo } from 'model';

class LoginLayoutViewModel {
    constructor() {
        this.form = ko.pureComputed(() => {
            if (isDefined(serverInfo())) {
                return serverInfo().initialized ? 'signin-form' : 'create-system-form';
            }
        });
    }
}

export default {
    viewModel: LoginLayoutViewModel,
    template: template
};
