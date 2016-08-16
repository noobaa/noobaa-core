import ko from 'knockout';
import { isObject, isString } from 'utils';

const tooltip = document.createElement('p');
const delay = 350;
const alignments = Object.freeze({
    left: 0,
    center: .5,
    right: 1
});

function toHtmlList(arr) {
    return `<ul>${
        arr.map(
            item => `<li>${item}</li>`
        ).join('')
    }</ul>`;
}

function normalizeValue(value) {
    if (isString(value)) {
        return {
            text: value,
            css: 'center',
            align: alignments.center,
            breakWords: false
        };

    } else if (value instanceof Array) {
        return {
            text: value.length === 1 ? value : toHtmlList(value),
            css: 'center',
            align: alignments.center,
            breakWords: false
        };

    } else if (isObject(value)) {
        let text = ko.unwrap(value.text);
        if (text instanceof Array) {
            text = value.length === 1 ? value : toHtmlList(value);
        }

        let pos = ko.unwrap(value.align);
        if (!Object.keys(alignments).includes(pos)) {
            pos = 'center';
        }

        return {
            text: text,
            css: pos,
            align: alignments[pos],
            breakWords: Boolean(ko.unwrap(value.breakWords))
        };
    } else {
        return {};
    }
}

function showTooltip(target, { text, css, align, breakWords }) {
    tooltip.innerHTML = text;
    tooltip.className = `tooltip ${css} ${breakWords ? 'break-words' : ''}`;
    document.body.appendChild(tooltip);

    let { left, top } = target.getBoundingClientRect();
    top += target.offsetHeight;
    left += target.offsetWidth / 2 - tooltip.offsetWidth * align;
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
            () => hover() && showTooltip(target, params())
        );

        let hoverSub = hover
            .extend({
                rateLimit: {
                    timeout: delay,
                    method: 'notifyWhenChangesStop'
                }
            })
            .subscribe(
                hoverd => {
                    return (hoverd && params().text) ?
                        showTooltip(target, params()) :
                        hideTooltip();
                }
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
