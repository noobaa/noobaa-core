import template from './accounts-table.html';
import ko from 'knockout';
import AccountRowViewModel from './account-row';
import { accountList } from 'model';
import { loadAccountList } from 'actions';
import { makeArray } from 'utils';

const maxRows = 100;

class AccountsTableViewModel {
	constructor() {
		this.deleteGroup = ko.observable();

		this.rows = makeArray(
			maxRows, 
			i => new AccountRowViewModel(
				() => accountList()[i], this.deleteCandidate
			)
		);

		this.isCreateAccountModalVisible = ko.observable(false);


		loadAccountList();
		
		// this is leaking, find another solution.
		// refreshCounter.subscribe(
		// 	() => loadAccountList()
		// )
	}
}

export default {
	viewModel: AccountsTableViewModel,
	template: template
}