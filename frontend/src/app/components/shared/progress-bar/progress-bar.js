/* Copyright (C) 2016 NooBaa */

import template from './progress-bar.html';
import ko from 'knockout';
import { clamp } from 'utils/core-utils';
import numeral from 'numeral';

class ProgressBarViewModel {
    constructor(params) {
        const {
            progress = 0,
            marker = false
        } = params;

        const ratio = ko.pureComputed(() =>
            clamp(ko.unwrap(progress) || 0, 0, 1)
        );

        this.values = [
            {
                color: 'rgb(var(--color20))',
                value: ratio
            },
            {
                color: 'rgb(var(--color09))',
                value: ko.pureComputed(() =>
                    1 - ratio()
                )
            }
        ];

        this.markers = [
            {
                visible: marker,
                position: 1,
                text: numeral(ratio).format('%')
            }
        ];
    }

}

export default {
    viewModel: ProgressBarViewModel,
    template: template
};
