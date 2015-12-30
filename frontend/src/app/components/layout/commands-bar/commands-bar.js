import template from './commands-bar.html'; 
import page from 'page';
import { refresh } from 'actions';

class CommandBarViewModel {
	constructor() {
		this.refresh = refresh;
	}

	refresh() {
		refresh();
	}
}

export default { 
	viewModel: CommandBarViewModel,
	template: template
}
