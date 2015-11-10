import template from './breadcrumbs.html';
import rx from 'rxjs';
import { appState } from 'shared-streams';

class BreadcrumbsViewModel {
	constructor(parmas) {

		this.parts = appState
			.pluck('path')
			.map(path => path.split('/')
				.filter( (_, i, arr) =>  1 < i && i < arr.length - 1 )
				.map( (name, i, arr) => ({ 
					label: decodeURIComponent(name), 
					href: '/' + arr.slice(0, i + 1).join('/') 
				}) )
			)
			.toKO();
	}
}

export default { 
	viewModel: BreadcrumbsViewModel,
	template: template
}
