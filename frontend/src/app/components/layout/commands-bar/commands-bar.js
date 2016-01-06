import template from './commands-bar.html'; 
import { refresh, signOut } from 'actions';

class CommandBarViewModel {
	constructor() {
		this.refresh = refresh;
	}

	refresh() {
		refresh();
	}

	signOut() {
		signOut();
	}
}

export default { 
	viewModel: CommandBarViewModel,
	template: template
}
