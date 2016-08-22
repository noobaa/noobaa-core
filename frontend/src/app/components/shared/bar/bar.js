import template from './bar.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';

const silhouetteColor = style['color1'];
const minRatio = .03;

class BarViewModel extends Disposable {
    constructor({ values = [] }) {
        super();

        this.total = ko.pureComputed(
            () => values.reduce(
                (sum, entry) => sum + ko.unwrap(entry.value),
                0
            )
        );

        this.values = values;

    }

    draw(ctx, { width, height }) {
        let { total, values } = this;

        // Clear the bar.
        ctx.fillStyle = ko.unwrap(silhouetteColor);
        ctx.fillRect(0, 0, width, height);

        values.reduce(
            (offset, item) => {
                let value = ko.unwrap(item.value);
                let ratio = value !== 0 ? Math.max(value / total(), minRatio) : 0;

                ctx.fillStyle = ko.unwrap(item.color);
                ctx.fillRect(offset + .5 | 0, 0, ratio * width + .5 | 0, height);

                return offset + ratio * width;
            },
            0
        );
    }
}

export default {
    viewModel: BarViewModel,
    template: template
};
