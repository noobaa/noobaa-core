import template from './accounts-table.html';
import ko from 'knockout';
import AccountRowViewModel from './account-row';
import { accountList } from 'model';
import { loadAccountList } from 'actions';
import { makeArray } from 'utils';

const maxRows = 100;

class AccountsTableViewModel {
	constructor() {
		loadAccountList();

		this.deleteCandidate = ko.observable();

		this.rows = makeArray(
			maxRows, 
			i => new AccountRowViewModel(
				() => accountList()[i], this.deleteCandidate
			)
		);
	}
}

export default {
	viewModel: AccountsTableViewModel,
	template: template
}