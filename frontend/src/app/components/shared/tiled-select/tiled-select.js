import template from './tiled-select.html';
import ko from 'knockout';

class TiledSelectViewModel {
	constructor({ }) {
		let tiles = ['tile 1', 'tile 2', 'tile 3'];

		this.selectedTile = ko.observable();



		this.tiles = ko.observableArray(
			tiles.map(label => {
				let tile = {
					icon: '/fe/assets/icons.svg#bucket-unselected',
					label: label,
					selected: ko.pureComputed({
						read: () => this.selectedTile() === tile,
						write: val => val === true && this.selectedTile(val)
					})
				};

				return tile;
			})	
		);
	}
}

export default {
	viewModel: TiledSelectViewModel,
	template: template
};