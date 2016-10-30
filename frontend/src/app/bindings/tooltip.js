import ko from 'knockout';
import { isObject, isString, deepFreeze } from 'utils';

const tooltip = document.createElement('p');
const delay = 350;

const positions = deepFreeze({
    above: 0,
    after: 1,
    below: 2,
    before: 3
});

const alignments = deepFreeze({
    start: 0,
    center: .5,
    end: 1
});

function toHtmlList(arr) {
    return `<ul class="bullet-list">${
        arr.map(
            item => `<li>${item}</li>`
        ).join('')
    }</ul>`;
}

function normalizeValue(value) {
    if (isString(value)) {
        return {
            text: value,
            position: 'below',
            align: 'center',
            breakWords: false
        };

    } else if (value instanceof Array) {
        return {
            text: value.length === 1 ? value : toHtmlList(value),
            position: 'below',
            align: 'center',
            breakWords: false
        };

    } else if (isObject(value)) {
        let text = ko.unwrap(value.text);
        if (text instanceof Array) {
            text = value.length === 1 ? value : toHtmlList(value);
        } else if (isObject(text)) {
            let { title  = '', list = [] } = text;
            text = `<p>${title}:</p>${toHtmlList(list)}`;
        }

        let position = ko.unwrap(value.position);
        if (!Object.keys(positions).includes(position)) {
            position = 'below';
        }

        let align = ko.unwrap(value.align);
        if (!Object.keys(alignments).includes(align)) {
            align = 'center';
        }

        return {
            text: text,
            position: position,
            align: align,
            breakWords: Boolean(ko.unwrap(value.breakWords))
        };

    } else {
        return {};
    }
}

function showTooltip(target, { text, align, position, breakWords }) {
    tooltip.innerHTML = text;
    tooltip.className = `tooltip ${align} ${position} ${breakWords ? 'break-words' : ''}`;
    document.body.appendChild(tooltip);

    let alignFactor = alignments[align];
    let { left, top, bottom, right } = target.getBoundingClientRect();

    switch (positions[position]) {
        case positions.above:
            top -= tooltip.offsetHeight;
            left += target.offsetWidth / 2 - tooltip.offsetWidth * alignFactor;
            break;

        case positions.after:
            top += target.offsetHeight / 2 - tooltip.offsetHeight * alignFactor;
            left = right;
            break;

        case positions.below:
            left += target.offsetWidth / 2 - tooltip.offsetWidth * alignFactor;
            top = bottom;
            break;

        case positions.before:
            top += target.offsetHeight / 2 - tooltip.offsetHeight * alignFactor;
            left -= tooltip.offsetWidth;
            break;
    }

    tooltip.style.top = `${Math.ceil(top)}px`;
    tooltip.style.left = `${Math.ceil(left)}px`;
}

function hideTooltip() {
    if (tooltip.parentElement) {
        document.body.removeChild(tooltip);
        tooltip.innerHTML = '';
    }
}

export default {
    init: function(target, valueAccessor) {
        let params = ko.pureComputed(
            () => normalizeValue(ko.unwrap(valueAccessor()))
        );

        let hover = ko.observable(false);

        let paramsSub = params.subscribe(
            params => (hover() && params.text) ?
                    showTooltip(target, params) :
                    hideTooltip()
        );

        let hoverSub = hover
            .extend({
                rateLimit: {
                    timeout: delay,
                    method: 'notifyWhenChangesStop'
                }
            })
            .subscribe(
                hoverd => (hoverd && params().text) ?
                    showTooltip(target, params()) :
                    hideTooltip()
            );

        // Handle delyed hover state.
        ko.utils.registerEventHandler(target, 'mouseenter', () => hover(true));
        ko.utils.registerEventHandler(target, 'mouseleave', () => hover(false));

        // Cleanup code.
        ko.utils.domNodeDisposal.addDisposeCallback(
            target,
            () => {
                hideTooltip(tooltip);
                paramsSub.dispose();
                hoverSub.dispose();
            }
        );
    }
};
