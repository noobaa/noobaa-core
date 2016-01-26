import ko from 'knockout';
import { systemInfo } from 'model';
import { deleteAccount } from 'actions';

export default class AccountRowViewModel {
	constructor(account, deleteCandidate) {
		let systemName = ko.pureComputed(
			() => systemInfo() ? systemInfo().name : ''
		);

		this.isVisible = ko.pureComputed(
			() => !!account()
		);

		this.user = ko.pureComputed(
			() => !!account() && account().email
		);

		this.roles = ko.pureComputed(
			() => {
				if (!systemName()) {
					return '';
				}

				return account().systems
					.find(
						({ name }) => name === systemName()
					)
					.roles
					.join(' | ')
			}
		);

		// TODO: return real status when avaliable
		this.status = ko.pureComputed(
			() => 'active' 
		);	
	}

	del() {
		deleteAccount(this.user())
	}
}