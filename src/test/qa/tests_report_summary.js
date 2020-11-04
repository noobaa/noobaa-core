/* Copyright (C) 2016 NooBaa */
'use strict';


// const mongodb = require('mongodb');
const argv = require('minimist')(process.argv);
const moment = require('moment');
const mongodb = require('mongodb');
const _ = require('lodash');
const fs = require('fs');

// require promise to promisify fs
require('../../util/promise');

const DATE_FORMAT = 'DD-MM-YYYY';
const SEPARATOR = ',';
const DAY_IN_MS = 1000 * 60 * 60 * 24;


function error(msg) {
    const err = new Error(msg);
    if (argv.debug) {
        console.error('ERROR:', err.stack);
    }
    throw err;
}

function debug(...msg) {
    if (argv.debug) {
        console.log('DEBUG: ', ...msg);
    }
}

function arg_to_date(arg) {
    if (!arg) return;
    let moment_date = moment.utc(arg, DATE_FORMAT);
    if (!moment_date.isValid()) error(`Invalid date format: ${arg}`);
    return moment_date.toDate();
}

function arg_to_days(arg, days_or_weeks) {
    let days = Number.parseInt(arg, 10);
    if (Number.isNaN(days)) error(`Invalid number of ${days_or_weeks}: ${argv.weeks}`);
    if (days_or_weeks === 'weeks') days *= 7;
    return days;
}

class ReportsSummarizer {


    constructor(params) {
        this.init_params(params);
        this.connection_string = 'mongodb://summarizer:T3st1ng1sFun!@ds139841.mlab.com:39841/test_reports';
    }

    async init() {
        this._db = await mongodb.MongoClient.connect(this.connection_string);
        this._reports = this._db.collection('reports');
        debug(`reports collection has ${await this._reports.countDocuments()} documents`);
    }

    init_params(params) {
        if (params.normalize) {
            this.normalize = params.normalize;
            this.till = new Date();
            this.since = moment.utc(Date.now()).startOf('day').toDate();
        } else if (params.since || params.till) {
            this.since = arg_to_date(params.since) || new Date(0);
            this.till = arg_to_date(params.till) || new Date();
        } else {
            let days = 0;
            if (params.weeks) {
                days = arg_to_days(params.weeks, 'weeks');
            }
            if (params.days) {
                days += arg_to_days(params.days, 'days');
            }
            days = days || 7;
            this.till = new Date();
            this.since = moment.utc(Date.now() - (days * DAY_IN_MS)).startOf('day').toDate();
            this.output_prefix = params.output_prefix;
        }
        // debug(`since=${this.since} till=${this.till}`);
    }

    async summarize() {
        console.log(`summarizing reports between the dates ${this.since.toDateString()} to ${this.till.toDateString()}`);
        const docs = await this.get_daily_reports();

        const suite_reports = _.groupBy(docs, 'suite_name');
        debug('suite names =', Object.keys(suite_reports));

        const suite_summaries = _.map(suite_reports, (reports, suite_name) => ({
            suite_name,
            lines: this.summarize_suite(reports, suite_name)
        }));

        for (const summary of suite_summaries) {
            if (this.output_prefix) {
                const filename = `${this.output_prefix}_${summary.suite_name}.csv`;
                await fs.promises.writeFile(filename, '');
                for (const line of summary.lines) {
                    await fs.promises.appendFile(filename, line + '\n');
                }
            } else {
                console.log(`------------------${summary.suite_name}------------------`);
                summary.lines.forEach(line => console.log(line));
            }
        }
    }

    async get_daily_reports() {
        const docs = await this._reports.find({
            date: _.omitBy({
                $gt: this.since,
                $lt: this.till
            }, _.isUndefined)
        }, {
            sort: {
                date: 1
            }
        }).toArray();

        // combine docs from the same date
        const reports_by_day = _.groupBy(docs, doc => `${moment.utc(doc.date).startOf('day')}_${doc.suite_name}`);
        const initial_report = {
            results: {
                passed_cases: {},
                failed_cases: {},
                didnt_run: {}
            }
        };
        const aggregated_docs = _.map(reports_by_day, reports => reports.reduce((reduced_doc, current_doc) => {
            const passed_cases = _.assignWith({},
                reduced_doc.results.passed_cases,
                current_doc.results.passed_cases,
                (obj_val = 0, src_val = 0) => obj_val + src_val);
            const failed_cases = _.assignWith({},
                reduced_doc.results.failed_cases,
                current_doc.results.failed_cases,
                (obj_val = 0, src_val = 0) => obj_val + src_val);
            const didnt_run = _.assignWith({},
                reduced_doc.results.didnt_run,
                current_doc.results.didnt_run,
                (obj_val = 0, src_val = 0) => obj_val + src_val);
            return {
                date: current_doc.date,
                suite_name: current_doc.suite_name,
                results: {
                    passed_cases,
                    failed_cases,
                    didnt_run
                }
            };
        }, initial_report));

        debug(`found ${docs.length} documents. reduced to ${aggregated_docs.length}`);
        return aggregated_docs;
    }

    summarize_suite(reports, suite_name) {
        debug(`summarizing ${reports.length} reports for suite ${suite_name}`);
        const all_cases = _.union(...reports.map(report =>
            Object.keys(report.results.passed_cases)
            .concat(Object.keys(report.results.failed_cases))
            .concat(Object.keys(report.results.didnt_run))
        )).sort();
        // debug(`cases for suite ${suite_name}:`, all_cases);

        // create top row with reports dates:
        const date_line_Array = ['Date', ...reports.map(report => report.date.toDateString())];

        if (this.normalize) {
            const date_line = date_line_Array.join(SEPARATOR);
            const final_lines = all_cases.map(test_case => {
                const case_results = reports.map(report => {
                    const { passed_cases, failed_cases /*, didnt_run  */} = report.results;
                    if (passed_cases[test_case] > 0) {
                        return 1;
                    } else if (failed_cases[test_case] > 0) {
                        return 0;
                    } else {
                        return -1;
                    }
                });
                return [test_case, ...case_results].join(SEPARATOR);
                //TODO: decide on the "_.sum", it is for the total.
                //return [test_case, ...case_results, _.sum(case_results)].join(SEPARATOR);
            });
            return [date_line, ...final_lines];
        } else {
            date_line_Array.push('Total');
            const date_line = date_line_Array.join(SEPARATOR);
            // create rows for passed cases
            const passed_lines = all_cases.map(test_case => {
                const case_results = reports.map(report => report.results.passed_cases[test_case] || 0);
                return [`Passed_${test_case}`, ...case_results, _.sum(case_results)].join(SEPARATOR);
            });

            // create rows for failed cases
            const failed_lines = all_cases.map(test_case => {
                const case_results = reports.map(report => report.results.failed_cases[test_case] || 0);
                return [`Failed_${test_case}`, ...case_results, _.sum(case_results)].join(SEPARATOR);
            });

            // create rows for didn't run cases
            const didnt_run_lines = all_cases.map(test_case => {
                const case_results = reports.map(report => report.results.didnt_run[test_case] || 0);
                return [`didnt_run_${test_case}`, ...case_results, _.sum(case_results)].join(SEPARATOR);
            });
            return [date_line, ...passed_lines, ...failed_lines, ...didnt_run_lines];
        }
    }
}

function print_usage() {
    console.log(`
    Usage:
    default summary is 7 days back. for a different time period use these flags:
        --since:            start date in the format ${DATE_FORMAT}
        --till:             end date in the format ${DATE_FORMAT}
        --days:             number of days back to summarize
        --weeks:            number of weeks back to summarize
        --output_prefix     prefix for output files (test suite name is added as a suffix)
        --normalize         get the report in normalized format
        `);
}

async function main() {
    if (argv.help) {
        print_usage();
        process.exit(1);
    }
    try {
        const summarizer = new ReportsSummarizer(argv);
        await summarizer.init();
        await summarizer.summarize();
        process.exit(0);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }

}

if (require.main === module) {
    main();
    // init_params
}
