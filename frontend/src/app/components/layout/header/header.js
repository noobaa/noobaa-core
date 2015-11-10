import template from './header.html';
import { appState } from 'shared-streams';

class HeaderViewModel {
	constructor() {

		this.text = appState
			.pluck('path')
			.map( path => decodeURIComponent(
				path.split('/').slice(-1)[0]
			) )
			.toKO();
	}
}

export default { 
	viewModel: HeaderViewModel,
	template: template
}
