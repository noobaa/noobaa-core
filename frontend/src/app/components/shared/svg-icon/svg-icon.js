import template from './svg-icon.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { realizeUri } from 'utils';
import { asset as assetsRoute } from 'routes';
import { defaultIconFile } from 'config.json';

class SVGIconViewModel extends BaseViewModel {
    constructor({ name, asset = defaultIconFile, fill, stroke }) {
        super();

        this.href = ko.pureComputed(
            () => `${
                realizeUri(assetsRoute, { asset: ko.unwrap(asset) })
            }#${
                ko.unwrap(name)
            }`
        );
        this.fill = fill;
        this.stroke = stroke;

    }
}

export default {
    viewModel: SVGIconViewModel,
    template: template
};
