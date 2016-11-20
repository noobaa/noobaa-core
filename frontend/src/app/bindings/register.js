export default function register(ko) {
    // Extending existing handlers
    ko.bindingHandlers.template        = require('./template-ex');

    // Registering new handlers
    ko.bindingHandlers.let          = require('./let');
    ko.bindingHandlers.visibility   = require('./visibility');
    ko.bindingHandlers.href         = require('./href');
    ko.bindingHandlers.scroll       = require('./scroll');
    ko.bindingHandlers.canvas       = require('./canvas');
    ko.bindingHandlers.transition   = require('./transition');
    ko.bindingHandlers.animation    = require('./animation');
    ko.bindingHandlers.expand       = require('./expand');
    ko.bindingHandlers.tooltip      = require('./tooltip');
    ko.bindingHandlers.scrollTo     = require('./scroll-to');
    ko.bindingHandlers.hover        = require('./hover');
    ko.bindingHandlers.shakeOnClick = require('./shake-on-click');
    ko.bindingHandlers.childEvent   = require('./child-event');
    ko.bindingHandlers.globalEvent  = require('./global-event');
    ko.bindingHandlers.chartjs      = require('./chartjs');
}
