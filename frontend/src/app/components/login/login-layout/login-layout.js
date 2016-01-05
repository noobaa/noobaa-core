import template from './login-layout.html';
import ko from 'knockout';
import { isDefined } from 'utils';
import { loginInfo, serverInfo,  } from 'model';

class LoginLayoutViewModel {
	constructor() {
		this.form = ko.pureComputed(() => {
			if (isDefined(serverInfo())) {
				return serverInfo().initialized ? 'signin-form' : 'create-system-form';
			}
		});

		let retryCount = ko.pureComputed(
			() => loginInfo().retryCount
		);

		let temp = this.temp = ko.observable(0);
		this.shake = ko.pureComputed({
			read: () => retryCount() > temp(),
			write: val => val === false && temp(retryCount())
		});
	}
}

export default {
	viewModel: LoginLayoutViewModel,
	template: template
}