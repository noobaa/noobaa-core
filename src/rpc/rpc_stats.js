'use strict';

var _ = require('lodash');
var Stats = require('fast-stats').Stats;
var dbg = require('noobaa-util/debug_module')(__filename);


module.exports = RpcStats;

var topStatSize = 60;
var statIntervalPushCounter = 1000;
var statIntervalPrint = 10000;
var collectStats = true;


function RpcStats() {
    var self = this;
    this._stats = {};
    if (collectStats) {
        this.intStat = setInterval(function() {
            try {
                self._handleStats();
            } catch (err) {
                dbg.error('Error running stats', err, err.stack);
            }
        }, statIntervalPushCounter);
        this.intStat.unref();

        this.intPrtStat = setInterval(function() {
            try {
                dbg.info(self._getStats());
            } catch (err) {
                dbg.error('Error running print stats', err, err.stack);
            }
        }, statIntervalPrint);
        this.intPrtStat.unref();
    }

}

RpcStats.prototype._addStatsCounter = function(name, value) {
    if (!collectStats) {
        return;
    }
    var self = this;
    try {
        if (!self._stats[name]) {
            self._stats[name] = {
                stat: new Stats({
                    sampling: true
                }),
                current: 0,
                isSum: true
            };
        }
        self._stats[name].current += value;
        dbg.log3('RpcStats addStatsVal', name, value);
    } catch (err) {
        dbg.error('Error addStatsVal', name, err, err.stack);
    }
};

RpcStats.prototype._addStats = function(name, value) {
    if (!collectStats) {
        return;
    }
    var self = this;
    try {
        if (!self._stats[name]) {
            self._stats[name] = {
                stat: new Stats()
            };
        }
        self._stats[name].stat.push(value);

        dbg.log3('RpcStats addStats', name, value);
    } catch (err) {
        dbg.error('Error addStats', name, err, err.stack);
    }
};

RpcStats.prototype._handleStats = function() {
    var self = this;

    try {
        _.each(self._stats, function(stats, name) {
            var stat = stats.stat;

            if (stats.isSum) {
                stat.push(stats.current);
            }

            while (stat.length > topStatSize) {
                stat.shift();
            }

        });
    } catch (err) {
        dbg.error('Error addToStat', err, err.stack);
    }
};

RpcStats.prototype._getStats = function() {
    var self = this;
    var result = 'Statistics: ';
    var stat;
    try {
        _.each(self._stats, function(stats, name) {
            stat = stats.stat;
            result += '\nname: ' + name + ' size: ' + stat.length + ' mean: ' + stat.amean().toFixed(2);
            if (stats.isSum) {
                result += ' (aprox last 60 secs) ';
            } else {
                result += ' (aprox last 60 tx) ';
            }
            result += ' median: ' + stat.median().toFixed(2) + ' range: [' + stat.range() + ']';
            if (stats.isSum) {
                result += ' current: ' + stats.current;
            }
        });
    } catch (err) {
        dbg.error('Error getStats', err, err.stack);
    }

    return result;
};
