import ko from 'knockout';
import { noop } from 'utils/core-utils';

export default {
    update: function(canvas, valueAccessor, allBindings, viewModel) {
        if (canvas.tagName.toUpperCase() !== 'CANVAS') {
            throw new Error('Invalid binding target');
        }

        const rect = canvas.getBoundingClientRect();
        const {
            draw = noop,
            width = rect.width | 0,
            height = rect.height | 0
        } = ko.deepUnwrap(valueAccessor());

        canvas.width = width;
        canvas.height = height;

        draw.call(
            viewModel,
            canvas.getContext('2d'),
            { width, height }
        );
    }
};
