/* Copyright (C) 2016 NooBaa */

import template from './timezone-chooser.html';
import moment from 'moment-timezone';

const options = moment.tz.names()
    .map(
        name => ({
            name: name,
            offset: moment.tz(name).utcOffset()
        })
    )
    .sort(
        (tz1, tz2) => tz1.offset - tz2.offset
    )
    .map(
        ({ name }) => {
            let offsetText = moment().tz(name).format('[GMT]Z');
            let label = name.replace(/\_/g, ' ');

            return {
                label: `(${offsetText}) ${label}`,
                value: name
            };
        }
    );

class TimezoneChooserViewModel {
    constructor({ timezone }) {
        this.options = options;
        this.selected = timezone;
    }

    matchByTimezoneName(option, input) {
        let regExp = new RegExp(`\\b${input.replace('/', '\\/')}`);
        return regExp.test(option.label.toLowerCase());
    }
}

export default {
    viewModel: TimezoneChooserViewModel,
    template: template
};
