/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { noop } from 'utils/core-utils';

const domDataKey = 'canvasBackBuffer';

export default {
    init: function(canvas) {
        const backbuffer = document.createElement('canvas');
        backbuffer.width = canvas.width;
        backbuffer.height = canvas.height;
        ko.utils.domData.set(canvas, domDataKey, backbuffer);
    },

    update: function(canvas, valueAccessor, allBindings, viewModel) {
        if (canvas.tagName.toUpperCase() !== 'CANVAS') {
            throw new Error('Invalid binding target');
        }

        const backbuffer = ko.utils.domData.get(canvas, domDataKey);
        const rect = canvas.getBoundingClientRect();
        const {
            draw = noop,
            width = rect.width | 0,
            height = rect.height | 0
        } = ko.deepUnwrap(valueAccessor());

        backbuffer.width = width;
        backbuffer.height = height;
        draw.call(viewModel, backbuffer.getContext('2d'), { width, height });

        requestAnimationFrame(() => {
            const { width, height } = backbuffer;
            canvas.width = width;
            canvas.height = height;

            if (width > 0 && height > 0) {
                canvas.getContext('2d').drawImage(backbuffer, 0, 0);
            }
        });
    }
};
